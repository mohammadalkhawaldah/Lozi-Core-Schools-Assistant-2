"use client";

import AudioChat from "@/components/AudioChat";
import { ChatHistory } from "@/components/ChatDialog";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";
import { SimliAvatar } from "@/components/SimliAvatar";
import { useAudio } from "@/hooks/useAudio";
import { useSimliAvatar } from "@/hooks/useSimliAvatar";
import { useVAD } from "@/hooks/useVAD";
import { useWebsocket } from "@/hooks/useWebsocket";
import { useCallback, useEffect, useState } from "react";

import "./styles.css";

const SIMLI_MUTE_NATIVE_AUDIO =
  process.env.NEXT_PUBLIC_SIMLI_MUTE_NATIVE_AUDIO !== "false";

export default function Home() {
  const [prompt, setPrompt] = useState("");

  const {
    isReady: audioIsReady,
    playAudio,
    startRecording,
    stopRecording,
    stopPlaying,
    frequencies,
    playbackFrequencies,
  } = useAudio();
  const {
    videoRef: simliVideoRef,
    audioRef: simliAudioRef,
    status: simliStatus,
    error: simliError,
    isEnabled: simliEnabled,
    faceId: simliFaceId,
    start: startSimli,
    stop: stopSimli,
    handleAudioChunk: mirrorAudioToSimli,
    flushAudio: flushSimliAudio,
  } = useSimliAvatar();
  const handleIncomingAudio = useCallback(
    (audio: Int16Array<ArrayBuffer>) => {
      const muteNative =
        SIMLI_MUTE_NATIVE_AUDIO && simliEnabled && simliStatus === "ready";

      if (muteNative) {
        const silent = new Int16Array(audio.length);
        playAudio(silent);
      } else {
        playAudio(audio);
      }
      mirrorAudioToSimli(audio);
    },
    [mirrorAudioToSimli, playAudio, simliEnabled, simliStatus]
  );
  const handleAudioComplete = useCallback(() => {
    flushSimliAudio();
  }, [flushSimliAudio]);
  const {
    isReady: websocketReady,
    sendAudioMessage,
    sendTextMessage,
    history: messages,
    resetHistory,
    isLoading,
    agentName,
  } = useWebsocket({
    onNewAudio: handleIncomingAudio,
    onAudioDone: handleAudioComplete,
  });
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const {
    status: vadStatus,
    error: vadError,
    enable: enableHandsFree,
    disable: disableHandsFree,
  } = useVAD({
    onSpeechStart: async () => {
      await stopPlaying();
      flushSimliAudio();
      await startRecording();
    },
    onSpeechEnd: async () => {
      const recorded = await stopRecording();
      if (recorded && recorded.length > 0 && websocketReady) {
        sendAudioMessage(recorded);
      }
    },
    onError: () => {
      setHandsFreeEnabled(false);
    },
  });

  function handleSubmit() {
    setPrompt("");
    sendTextMessage(prompt);
  }

  async function handleStopPlaying() {
    await stopPlaying();
  }

  async function toggleHandsFree() {
    if (handsFreeEnabled) {
      await disableHandsFree();
      setHandsFreeEnabled(false);
      return;
    }
    const started = await enableHandsFree();
    setHandsFreeEnabled(started);
  }

  useEffect(() => {
    if (vadError) {
      setHandsFreeEnabled(false);
    }
  }, [vadError]);

  return (
    <div className="w-full h-dvh flex flex-col items-center">
      <h1 className="text-3xl font-bold text-center mt-8 mb-4">
        LOZI CORE AI SCHOOL ASSISTANT
      </h1>
      <Header
        agentName={agentName ?? ""}
        playbackFrequencies={playbackFrequencies}
        stopPlaying={handleStopPlaying}
        resetConversation={resetHistory}
      />
      <div className="w-full max-w-2xl px-5 mb-4">
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Hands-free mode</p>
              <p className="text-xs text-slate-500">
                {handsFreeEnabled
                  ? `Status: ${vadStatus}`
                  : "Tap to start listening automatically"}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleHandsFree}
              className={`text-xs font-medium rounded px-3 py-1.5 ${
                handsFreeEnabled
                  ? "bg-rose-50 text-rose-600 border border-rose-100"
                  : "bg-slate-900 text-white"
              }`}
            >
              {handsFreeEnabled ? "Disable" : "Enable"}
            </button>
          </div>
          {vadError && (
            <p className="text-xs text-rose-600">
              {vadError}
            </p>
          )}
        </div>
      </div>
      {simliEnabled && (
        <SimliAvatar
          videoRef={simliVideoRef}
          audioRef={simliAudioRef}
          status={simliStatus}
          error={simliError}
          faceId={simliFaceId ?? undefined}
          onRetry={() => {
            void startSimli();
          }}
          onStop={stopSimli}
        />
      )}
      <ChatHistory messages={messages} isLoading={isLoading} />
      <Composer
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        audioChat={
          <AudioChat
            frequencies={frequencies}
            isReady={websocketReady && audioIsReady && !handsFreeEnabled}
            startRecording={startRecording}
            stopRecording={stopRecording}
            sendAudioMessage={sendAudioMessage}
          />
        }
      />
    </div>
  );
}
