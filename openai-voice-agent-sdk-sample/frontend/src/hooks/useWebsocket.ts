import { useEffect, useRef, useState } from "react";

import { Message } from "@/lib/types";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/lib/utils";

const HISTORY_WINDOW =
  Number(process.env.NEXT_PUBLIC_HISTORY_WINDOW ?? "12") || 12;

function limitHistory(messages: Message[]) {
  return messages.slice(-HISTORY_WINDOW);
}

export function useWebsocket({
  url,
  onNewAudio,
  onAudioDone,
}: {
  url?: string;
  onNewAudio?: (audio: Int16Array<ArrayBuffer>) => void;
  onAudioDone?: () => void;
} = {}) {
  // Auto-detect WebSocket URL based on current environment
  const getWebSocketUrl = () => {
    if (typeof window === 'undefined') return "ws://localhost:8000/ws";
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    // If running on localhost, use the local backend
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return "ws://localhost:8000/ws";
    }
    
    // For production deployment, use the same host with WebSocket protocol
    return `${protocol}//${host}/ws`;
  };

  url = url ?? process.env.NEXT_PUBLIC_WEBSOCKET_ENDPOINT ?? getWebSocketUrl();
  const [isReady, setIsReady] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const websocket = useRef<WebSocket | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      setIsReady(true);
    });
    ws.addEventListener("close", () => {
      setIsReady(false);
    });
    ws.addEventListener("error", (event) => {
      setIsReady(false);
      setIsLoading(false);
      console.error("Websocket error", event);
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "history.updated") {
        if (data.inputs[data.inputs.length - 1].role !== "user") {
          setIsLoading(false);
        }
        setHistory(data.inputs);
        if (data.agent_name) {
          setAgentName(data.agent_name);
        }
      } else if (data.type === "response.audio.delta") {
        const audioData = new Int16Array(base64ToArrayBuffer(data.delta));
        if (typeof onNewAudio === "function") {
          onNewAudio(audioData);
        }
      } else if (data.type === "audio.done") {
        if (typeof onAudioDone === "function") {
          onAudioDone();
        }
      }
    });

    websocket.current = ws;
  }, [url, onNewAudio, onAudioDone]);

  useEffect(() => {
    return () => {
      websocket.current?.close();
    };
  }, []);

  function sendTextMessage(message: string) {
    setIsLoading(true);
    const seenIds = new Set<string>();
    const dedupedHistory = history.filter((msg) => {
      if ("id" in msg && msg.id) {
        if (seenIds.has(msg.id)) return false;
        seenIds.add(msg.id);
      }
      return true;
    });
    const newHistory = [
      ...limitHistory(dedupedHistory),
      {
        role: "user",
        content: message,
        type: "message",
      } as Message,
    ];
    setHistory(newHistory);
    websocket.current?.send(
      JSON.stringify({
        type: "history.update",
        inputs: newHistory,
      })
    );
  }

  function resetHistory() {
    setHistory([]);
    setIsLoading(false);
    setAgentName(null);
    websocket.current?.send(
      JSON.stringify({
        type: "history.update",
        inputs: [],
        reset_agent: true,
      })
    );
  }
  function sendAudioMessage(audio: Int16Array<ArrayBuffer>) {
    if (!websocket.current) {
      throw new Error("Websocket not connected");
    }
    const seenIds = new Set<string>();
    const dedupedHistory = history.filter((msg) => {
      if ("id" in msg && msg.id) {
        if (seenIds.has(msg.id)) return false;
        seenIds.add(msg.id);
      }
      return true;
    });
    const limitedHistory = limitHistory(dedupedHistory);
    websocket.current.send(
      JSON.stringify({
        type: "history.update",
        inputs: limitedHistory,
      })
    );
    websocket.current.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        delta: arrayBufferToBase64(audio.buffer),
      })
    );
    websocket.current.send(
      JSON.stringify({
        type: "input_audio_buffer.commit",
      })
    );
  }

  return {
    isReady,
    sendTextMessage,
    sendAudioMessage,
    history,
    resetHistory,
    agentName,
    isLoading,
  };
}
