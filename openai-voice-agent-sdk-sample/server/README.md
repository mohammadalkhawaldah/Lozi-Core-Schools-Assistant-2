# Voice Agents SDK Sample App

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![FastAPI](https://img.shields.io/badge/Built_with-FastAPI-yellow)
![NextJS](https://img.shields.io/badge/Built_with-NextJS-blue)
![OpenAI API](https://img.shields.io/badge/Powered_by-OpenAI_API-orange)

This repository contains a sample app to highlight how to build [voice agents](https://platform.openai.com/docs/guides/voice-agents) using the [Agents SDK](https://openai.github.io/openai-agents-python) and Python. The backend is written using FastAPI and exposes a websocket endpoint. The front-end is written using Next.js and connects to the websocket server.

Features:

- Multi-turn conversation handling
- Push-to-talk audio mode
- Function calling
- Streaming responses & tool calls

This app is meant to be used as a starting point to build a conversational assistant that you can customize to your needs.

## Optional: Simli avatar integration

The backend exposes `POST /simli/session`, which proxies Simli's session creation API so that browser clients can obtain short‑lived `session_token`s without exposing the Simli API key. To enable it:

1. Add the following variables to the project `.env` (loaded in `server/server.py`):

   ```bash
   SIMLI_API_KEY=<your_simli_api_key>
   SIMLI_FACE_ID=<preferred_face_id>
   # Optional overrides with sane defaults:
   SIMLI_MODEL=fasttalk
   SIMLI_HANDLE_SILENCE=true
   SIMLI_MAX_SESSION_LENGTH=3600
   SIMLI_MAX_IDLE_TIME=600
   SIMLI_API_BASE=https://api.simli.ai
   ```

2. In the frontend, set `NEXT_PUBLIC_ENABLE_SIMLI=true`. If the backend runs on a different origin, also set `NEXT_PUBLIC_SERVER_BASE_URL` (defaults to `http://localhost:8000` during development).

The frontend hook `useSimliAvatar` (see `frontend/src/hooks/useSimliAvatar.ts`) uses this endpoint to fetch session tokens, mirrors PCM audio streaming through the existing websocket, and renders the avatar with `simli-client`.

## Requirements

- OpenAI API key
  - If you're new to the OpenAI API, [sign up for an account](https://platform.openai.com/signup).
  - Follow the [Quickstart](https://platform.openai.com/docs/quickstart) to retrieve your API key.
- Node.js and npm
- `uv` installed on your system

## How to use

1. **Set the OpenAI API key:**

   2 options:

   - Set the `OPENAI_API_KEY` environment variable [globally in your system](https://platform.openai.com/docs/libraries#create-and-export-an-api-key)
   - Set the `OPENAI_API_KEY` environment variable in the project: Create a `.env` file at the root of the project and add the following line (see `.env.example` for reference):

   ```bash
   OPENAI_API_KEY=<your_api_key>
   ```

2. **Clone the Repository:**

   ```bash
   git clone https://github.com/openai/openai-voice-agent-sdk-sample.git
   cd openai-voice-agent-sdk-sample/ 
   ```

3. **Install dependencies:**

   You will have to install both the dependencies for the front-end and the server. To do this run in the project root:

   ```bash
   make sync
   ```

4. **Run the app:**

   ```bash
   make serve
   ```

   The app will be available at [`http://localhost:3000`](http://localhost:3000).

## Contributing

You are welcome to open issues or submit PRs to improve this app, however, please note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
