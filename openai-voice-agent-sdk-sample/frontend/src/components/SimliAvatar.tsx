"use client";

import clsx from "clsx";
import type { RefObject } from "react";

interface SimliAvatarProps {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  status: "disabled" | "idle" | "connecting" | "ready" | "error";
  error?: string | null;
  faceId?: string | null;
  onRetry: () => void;
  onStop: () => void;
}

export function SimliAvatar({
  videoRef,
  audioRef,
  status,
  error,
  faceId,
  onRetry,
  onStop,
}: SimliAvatarProps) {
  if (status === "disabled") {
    return null;
  }

  const showRetry = status === "error" || status === "idle";

  return (
    <div className="w-full max-w-2xl flex flex-col gap-3 border border-slate-200 rounded-xl p-4 bg-white shadow-sm mt-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-semibold">Simli Avatar</p>
          <p className="text-xs text-slate-600">
            Status:{" "}
            <span
              className={clsx("font-medium", {
                "text-emerald-600": status === "ready",
                "text-amber-600": status === "connecting",
                "text-rose-600": status === "error",
                "text-slate-500": status === "idle",
              })}
            >
              {status}
            </span>
          </p>
          {faceId && (
            <p className="text-xs text-slate-500 mt-1">Face ID: {faceId}</p>
          )}
        </div>
        <div className="flex gap-2">
          {showRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-medium text-white bg-slate-900 rounded px-3 py-1.5 hover:bg-slate-800"
            >
              {status === "error" ? "Retry" : "Start"}
            </button>
          )}
          {status === "ready" && (
            <button
              type="button"
              onClick={onStop}
              className="text-xs font-medium text-slate-700 border border-slate-200 rounded px-3 py-1.5 hover:bg-slate-50"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="relative w-full h-64 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        <audio ref={audioRef} autoPlay className="hidden" />
        {status !== "ready" && (
          <p className="text-sm text-slate-500 absolute">
            {status === "connecting"
              ? "Connecting avatar…"
              : "Avatar is not running"}
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600 border border-rose-100 bg-rose-50 rounded px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
