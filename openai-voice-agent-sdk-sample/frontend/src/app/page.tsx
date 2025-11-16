"use client";

import AudioChat from "@/components/AudioChat";
import { ChatHistory } from "@/components/ChatDialog";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";
import { SimliAvatar } from "@/components/SimliAvatar";
import { useAudio } from "@/hooks/useAudio";
import { useSimliAvatar } from "@/hooks/useSimliAvatar";
import { useWebsocket } from "@/hooks/useWebsocket";
import { useCallback, useState } from "react";

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

  function handleSubmit() {
    setPrompt("");
    sendTextMessage(prompt);
  }

  async function handleStopPlaying() {
    await stopPlaying();
  }

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
            isReady={websocketReady && audioIsReady}
            startRecording={startRecording}
            stopRecording={stopRecording}
            sendAudioMessage={sendAudioMessage}
          />
        }
      />
    </div>
  );
}
