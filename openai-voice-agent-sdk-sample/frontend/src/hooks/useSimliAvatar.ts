"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SimliClient as SimliClientType } from "simli-client";

type SimliStatus = "disabled" | "idle" | "connecting" | "ready" | "error";

interface SimliSessionResponse {
  sessionToken: string;
  faceId: string;
  handleSilence: boolean;
  maxSessionLength: number;
  maxIdleTime: number;
  model: string;
  iceServers?: unknown;
}

const SIMLI_ENABLED =
  typeof process.env.NEXT_PUBLIC_ENABLE_SIMLI !== "undefined" &&
  process.env.NEXT_PUBLIC_ENABLE_SIMLI !== "false";

const ASSISTANT_SAMPLE_RATE = Number(
  process.env.NEXT_PUBLIC_ASSISTANT_SAMPLE_RATE ?? 24000
);
const SIMLI_SAMPLE_RATE = Number(
  process.env.NEXT_PUBLIC_SIMLI_SAMPLE_RATE ?? 16000
);

const SIMLI_API_BASE =
  process.env.NEXT_PUBLIC_SIMLI_API_BASE ?? "https://api.simli.ai";

function getBackendBaseUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_BASE_URL) {
    return process.env.NEXT_PUBLIC_SERVER_BASE_URL;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (hostname.includes("localhost") || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8000`;
    }
    if (port) {
      return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    }
    return `${protocol}//${hostname}`;
  }

  return "http://localhost:8000";
}

async function importClientCtor() {
  const mod = await import("simli-client");
  return mod.SimliClient;
}

function downsamplePCM(
  input: Int16Array,
  inputSampleRate: number,
  targetSampleRate: number
) {
  if (inputSampleRate === targetSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.floor(input.length / ratio);
  const result = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.min(
      input.length,
      Math.round((offsetResult + 1) * ratio)
    );
    let accumulator = 0;
    let count = 0;

    for (let i = offsetInput; i < nextOffsetInput; i++) {
      accumulator += input[i];
      count++;
    }

    result[offsetResult] =
      count > 0 ? Math.round(accumulator / count) : input[offsetInput];

    offsetResult++;
    offsetInput = nextOffsetInput;
  }

  return result;
}

export function useSimliAvatar({ autoStart = true } = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<SimliClientType | null>(null);
  const [status, setStatus] = useState<SimliStatus>(
    SIMLI_ENABLED ? "idle" : "disabled"
  );
  const [error, setError] = useState<string | null>(null);
  const [faceId, setFaceId] = useState<string | null>(null);
  const backendBaseUrl = useMemo(getBackendBaseUrl, []);

  const ensureClient = useCallback(async () => {
    if (clientRef.current) {
      return clientRef.current;
    }
    const SimliClientCtor = await importClientCtor();
    clientRef.current = new SimliClientCtor();
    return clientRef.current;
  }, []);

  const teardownClient = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.close();
    }
    clientRef.current = null;
    setStatus(SIMLI_ENABLED ? "idle" : "disabled");
  }, []);

  useEffect(() => {
    return () => {
      teardownClient();
    };
  }, [teardownClient]);

  const fetchSession = useCallback(async (): Promise<SimliSessionResponse> => {
    const response = await fetch(`${backendBaseUrl}/simli/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        include_ice_servers: true,
        face_id: process.env.NEXT_PUBLIC_SIMLI_FACE_ID,
      }),
    });

    if (!response.ok) {
      throw new Error(`Simli session request failed (${response.status})`);
    }
    return response.json();
  }, [backendBaseUrl]);

  const start = useCallback(async () => {
    if (!SIMLI_ENABLED) {
      return false;
    }

    if (!videoRef.current || !audioRef.current) {
      setError("Avatar elements have not mounted yet.");
      return false;
    }

    setStatus("connecting");
    setError(null);

    try {
      const [client, session] = await Promise.all([
        ensureClient(),
        fetchSession(),
      ]);

      setFaceId(session.faceId);
      client.Initialize({
        apiKey: "",
        session_token: session.sessionToken,
        faceID: session.faceId,
        handleSilence: session.handleSilence,
        maxSessionLength: session.maxSessionLength,
        maxIdleTime: session.maxIdleTime,
        model: session.model,
        videoRef: videoRef.current,
        audioRef: audioRef.current,
        enableConsoleLogs:
          process.env.NEXT_PUBLIC_SIMLI_DEBUG === "true" ||
          process.env.NODE_ENV !== "production",
        SimliURL: SIMLI_API_BASE,
      });

      client.on("failed", (reason) => {
        setError(reason);
        setStatus("error");
      });
      client.on("disconnected", () => {
        setStatus("idle");
      });
      client.on("connected", () => {
        setStatus("ready");
      });

      await client.start();
      setStatus("ready");
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start Simli avatar";
      setError(message);
      setStatus("error");
      return false;
    }
  }, [ensureClient, fetchSession]);

  useEffect(() => {
    if (SIMLI_ENABLED && autoStart) {
      void start();
    }
  }, [autoStart, start]);

  const stop = useCallback(() => {
    teardownClient();
    setFaceId(null);
  }, [teardownClient]);

  const handleAudioChunk = useCallback((chunk: Int16Array) => {
    if (!SIMLI_ENABLED) return;
    if (!clientRef.current) return;
    if (status !== "ready" && status !== "connecting") return;

    const processed = downsamplePCM(
      chunk,
      ASSISTANT_SAMPLE_RATE,
      SIMLI_SAMPLE_RATE
    );
    const payload = new Uint8Array(
      processed.buffer.slice(
        processed.byteOffset,
        processed.byteOffset + processed.byteLength
      )
    );
    clientRef.current.sendAudioData(payload);
  }, [status]);

  const flushAudio = useCallback(() => {
    clientRef.current?.ClearBuffer?.();
  }, []);

  return {
    videoRef,
    audioRef,
    status,
    error,
    isEnabled: SIMLI_ENABLED,
    faceId,
    start,
    stop,
    handleAudioChunk,
    flushAudio,
  };
}
