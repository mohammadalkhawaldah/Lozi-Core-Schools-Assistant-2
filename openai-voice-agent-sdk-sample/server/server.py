import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from logging import getLogger
from typing import Any, Dict

import httpx
import numpy as np

# Import core agent and voice pipeline logic
from agents import Runner, trace
from agents.voice import (
    TTSModelSettings,
    VoicePipeline,
    VoicePipelineConfig,
    VoiceWorkflowBase,
)
from agents.voice.models.openai_model_provider import OpenAIVoiceModelProvider

# Import configuration and utility functions
from app.agent_config import starting_agent
from app.arabic_tts_helper import get_arabic_tts_instructions
from app.utils import (
    WebsocketHelper,
    concat_audio_chunks,
    extract_audio_chunk,
    is_audio_complete,
    is_new_audio_chunk,
    is_new_text_message,
    is_sync_message,
    is_text_output,
    process_inputs,
    transform_data_to_events,
)
# FastAPI and middleware imports
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

# Load environment variables from .env file
from dotenv import load_dotenv
# When .env file is present, it will override the environment variables
load_dotenv(dotenv_path="../.env", override=True)

# Create FastAPI app instance
app = FastAPI()

logger = getLogger(__name__)

# Simli configuration
SIMLI_API_KEY = os.getenv("SIMLI_API_KEY")
SIMLI_FACE_ID = os.getenv("SIMLI_FACE_ID")
SIMLI_API_BASE = os.getenv("SIMLI_API_BASE", "https://api.simli.ai")
SIMLI_MODEL = os.getenv("SIMLI_MODEL", "fasttalk")
SIMLI_HANDLE_SILENCE = os.getenv("SIMLI_HANDLE_SILENCE", "true").lower() != "false"
SIMLI_MAX_SESSION_LENGTH = int(os.getenv("SIMLI_MAX_SESSION_LENGTH", "3600"))
SIMLI_MAX_IDLE_TIME = int(os.getenv("SIMLI_MAX_IDLE_TIME", "600"))
SIMLI_ENABLED = bool(SIMLI_API_KEY and SIMLI_FACE_ID)
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
TTS_VOICE = os.getenv("OPENAI_TTS_VOICE")
WELCOME_MESSAGE = (
    "أهلا بكم في بمدارس لوزي كور. أنا المساعد الذكي، أستطيع أن أقدم لك معلومات عن "
    "خدماتنا، وأن أجيب على أسئلتك التي تتعلق بأمور مثل التسجيل، المواصلات، "
    "الأوراق المطلوبة، المناهج وغيرها."
)


class CustomVoiceModelProvider(OpenAIVoiceModelProvider):
    def get_tts_model(self, model_name: str | None):
        # Force use of gpt-4o-mini-tts model
        return super().get_tts_model("gpt-4o-mini-tts")



class SimliSessionRequest(BaseModel):
    face_id: str | None = None
    handle_silence: bool | None = None
    max_session_length: int | None = None
    max_idle_time: int | None = None
    preload_avatar: bool | None = None
    include_ice_servers: bool = True
    model: str | None = None


class SimliSessionResponse(BaseModel):
    sessionToken: str
    faceId: str
    handleSilence: bool
    maxSessionLength: int
    maxIdleTime: int
    model: str
    iceServers: Any | None = None

# Enable CORS for all origins (for frontend-backend communication)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# VoiceWorkflowBase subclass to handle user input and agent response
class Workflow(VoiceWorkflowBase):
    def __init__(self, connection: WebsocketHelper):
        self.connection = connection

    # Main method to process text input and stream agent responses
    async def run(self, input_text: str) -> AsyncIterator[str]:
        # Get conversation history and latest agent
        conversation_history, latest_agent = await self.connection.show_user_input(
            input_text
        )

        # Run the agent and stream output events
        output = Runner.run_streamed(
            latest_agent,
            conversation_history,
        )

        async for event in output.stream_events():
            await self.connection.handle_new_item(event)

            if is_text_output(event):
                yield event.data.delta  # type: ignore

        await self.connection.text_output_complete(output, is_done=True)

# WebSocket endpoint for real-time chat and audio
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    with trace("Voice Agent Chat"):
        await websocket.accept()
        # Create a new WebsocketHelper for each connection
        connection = WebsocketHelper(websocket, [], starting_agent)
        audio_buffer = []

        workflow = Workflow(connection)
        while True:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                print("Client disconnected")
                return

            # Handle text-based messages (sync, new text, etc.)
            if is_sync_message(message):
                connection.history = message["inputs"]
                if message.get("reset_agent", False):
                    connection.latest_agent = starting_agent
                    await connection.cancel_greeting()
                    connection.greeting_sent = False
                    schedule_greeting(connection)
                elif not connection.greeting_sent and not connection.history:
                    schedule_greeting(connection)
            elif is_new_text_message(message):
                await connection.cancel_greeting()
                user_input = process_inputs(message, connection)
                async for new_output_tokens in workflow.run(user_input):
                    await connection.stream_response(new_output_tokens, is_text=True)

            # Handle incoming audio chunks
            elif is_new_audio_chunk(message):
                await connection.cancel_greeting()
                audio_buffer.append(extract_audio_chunk(message))

            # When audio is complete, process and send response
            elif is_audio_complete(message):
                await connection.cancel_greeting()
                start_time = time.perf_counter()

                # Function to print time to first byte for debugging
                def transform_data(data):
                    nonlocal start_time
                    if start_time:
                        print(
                            f"Time taken to first byte: {time.perf_counter() - start_time}s"
                        )
                        start_time = None
                    return data

                audio_input = concat_audio_chunks(audio_buffer)
                
                # Create a custom model provider that uses gpt-4o-mini-tts
                from agents.voice.models.openai_model_provider import OpenAIVoiceModelProvider
                
                output = await VoicePipeline(
                    workflow=workflow,
                    config=VoicePipelineConfig(
                        model_provider=CustomVoiceModelProvider(),
                        tts_settings=TTSModelSettings(
                            voice=TTS_VOICE,
                            instructions=get_arabic_tts_instructions(),
                            buffer_size=512, 
                            transform_data=transform_data
                        )
                    ),
                ).run(audio_input)
                async for event in output.stream():
                    await connection.send_audio_chunk(event)

                audio_buffer = []  # reset the audio buffer


@app.post("/simli/session", response_model=SimliSessionResponse)
async def create_simli_session(request: SimliSessionRequest) -> SimliSessionResponse:
    if not SIMLI_ENABLED:
        raise HTTPException(status_code=503, detail="Simli integration is not configured")

    face_id = request.face_id or SIMLI_FACE_ID  # type: ignore[arg-type]
    if not face_id:
        raise HTTPException(status_code=400, detail="A face ID is required to start a Simli session")

    payload: dict[str, Any] = {
        "faceId": face_id,
        "apiKey": SIMLI_API_KEY,
        "isJPG": False,
        "syncAudio": False,
        "audioInputFormat": "pcm16",
        "batchSize": 1,
        "handleSilence": (
            request.handle_silence
            if request.handle_silence is not None
            else SIMLI_HANDLE_SILENCE
        ),
        "maxSessionLength": (
            request.max_session_length
            if request.max_session_length is not None
            else SIMLI_MAX_SESSION_LENGTH
        ),
        "maxIdleTime": (
            request.max_idle_time
            if request.max_idle_time is not None
            else SIMLI_MAX_IDLE_TIME
        ),
        "preloadAvatar": request.preload_avatar or False,
        "model": request.model or SIMLI_MODEL,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            session_resp = await client.post(
                f"{SIMLI_API_BASE}/startAudioToVideoSession",
                json=payload,
            )
            session_resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Failed to create Simli session: %s", exc.response.text, exc_info=True
            )
            raise HTTPException(
                status_code=exc.response.status_code,
                detail="Simli session creation failed",
            ) from exc
        except httpx.HTTPError as exc:
            logger.error("Simli session request error: %s", exc, exc_info=True)
            raise HTTPException(status_code=502, detail="Simli API unreachable") from exc

        session_data = session_resp.json()
        session_token = session_data.get("session_token")
        if not session_token:
            logger.error("Simli session response missing session_token: %s", session_data)
            raise HTTPException(
                status_code=502, detail="Simli API returned an invalid response"
            )

        ice_servers = None
        if request.include_ice_servers:
            try:
                ice_resp = await client.post(
                    f"{SIMLI_API_BASE}/getIceServers",
                    json={"apiKey": SIMLI_API_KEY},
                )
                ice_resp.raise_for_status()
                ice_servers = ice_resp.json()
            except httpx.HTTPError as exc:
                # Non-fatal: avatar can still attempt connection with default ICE servers.
                logger.warning("Unable to retrieve Simli ICE servers: %s", exc)

    return SimliSessionResponse(
        sessionToken=session_token,
        faceId=face_id,
        handleSilence=payload["handleSilence"],
        maxSessionLength=payload["maxSessionLength"],
        maxIdleTime=payload["maxIdleTime"],
        model=payload["model"],
        iceServers=ice_servers,
    )

# Entry point for running the server locally
if __name__ == "__main__":
    import uvicorn

    # Start FastAPI app with Uvicorn (hot reload enabled)
    uvicorn.run("server:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
def schedule_greeting(connection: WebsocketHelper):
    if connection.greeting_sent:
        return
    if connection.greeting_task and not connection.greeting_task.done():
        return
    task = asyncio.create_task(send_welcome_message(connection))
    connection.set_greeting_task(task)


async def stream_text_as_audio(connection: WebsocketHelper, text: str):
    provider = CustomVoiceModelProvider()
    tts_model = provider.get_tts_model("gpt-4o-mini-tts")
    tts_settings = TTSModelSettings(
        voice=TTS_VOICE,
        instructions=get_arabic_tts_instructions(),
        buffer_size=512,
    )
    cancelled = False
    try:
        async for chunk in tts_model.run(text, tts_settings):
            if not chunk:
                continue
            audio_np = np.frombuffer(chunk, dtype=np.int16)
            await connection.websocket.send_text(
                json.dumps(transform_data_to_events(audio_np))
            )
    except asyncio.CancelledError:
        cancelled = True
        raise
    except Exception as exc:
        logger.error("Failed to stream greeting audio: %s", exc)
    finally:
        if not cancelled:
            await connection.send_audio_done()


async def send_welcome_message(connection: WebsocketHelper):
    try:
        if connection.greeting_sent:
            return
        connection.greeting_sent = True
        await connection.append_assistant_message(WELCOME_MESSAGE)
        await stream_text_as_audio(connection, WELCOME_MESSAGE)
    except asyncio.CancelledError:
        raise
    finally:
        connection.set_greeting_task(None)
