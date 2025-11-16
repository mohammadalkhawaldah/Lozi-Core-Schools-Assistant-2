"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MicVAD } from "@ricky0123/vad-web";
import { MicVAD as MicVADCtor } from "@ricky0123/vad-web";

type VADStatus =
  | "idle"
  | "initializing"
  | "listening"
  | "speaking"
  | "paused"
  | "error";

interface UseVADOptions {
  onSpeechStart?: () => Promise<void> | void;
  onSpeechEnd?: () => Promise<void> | void;
  onError?: (message: string) => void;
}

const DEFAULT_VAD_ASSET_VERSION =
  process.env.NEXT_PUBLIC_VAD_ASSET_VERSION ?? "0.0.29";
const DEFAULT_ONNX_VERSION =
  process.env.NEXT_PUBLIC_VAD_ONNX_VERSION ?? "1.22.0";
const VAD_ASSET_BASE = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${DEFAULT_VAD_ASSET_VERSION}/dist/`;
const ONNX_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${DEFAULT_ONNX_VERSION}/dist/`;

export function useVAD({
  onSpeechStart,
  onSpeechEnd,
  onError,
}: UseVADOptions = {}) {
  const vadRef = useRef<MicVAD | null>(null);
  const [status, setStatus] = useState<VADStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const destroy = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.destroy();
      vadRef.current = null;
    }
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      destroy();
    };
  }, [destroy]);

  const ensureInstance = useCallback(async () => {
    if (vadRef.current) {
      return vadRef.current;
    }
    setStatus("initializing");
    try {
      const instance = await MicVADCtor.new({
        startOnLoad: false,
        baseAssetPath: VAD_ASSET_BASE,
        onnxWASMBasePath: ONNX_BASE,
        positiveSpeechThreshold: 0.55,
        negativeSpeechThreshold: 0.4,
        preSpeechPaddingFrames: 6,
        redemptionFrames: 16,
        minSpeechFrames: 10,
        onSpeechStart: async () => {
          setStatus("speaking");
          await onSpeechStart?.();
        },
        onSpeechEnd: async () => {
          setStatus("listening");
          await onSpeechEnd?.();
        },
        onVADMisfire: () => {
          setStatus((prev) => (prev === "error" ? prev : "listening"));
        },
        onFrameProcessed: () => {},
        onSpeechRealStart: () => {},
      });
      vadRef.current = instance;
      return instance;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to initialize voice activity detection";
      setError(message);
      onError?.(message);
      setStatus("error");
      throw err;
    }
  }, [onError, onSpeechEnd, onSpeechStart]);

  const enable = useCallback(async () => {
    try {
      const vad = await ensureInstance();
      await vad.start();
      setError(null);
      setStatus("listening");
      return true;
    } catch {
      return false;
    }
  }, [ensureInstance]);

  const disable = useCallback(async () => {
    if (!vadRef.current) {
      return;
    }
    await vadRef.current.pause();
    setStatus("paused");
  }, []);

  return {
    status,
    error,
    enable,
    disable,
    destroy,
  };
}

