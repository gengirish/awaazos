"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Mic } from "lucide-react";

import { useVoiceOrder } from "@/hooks/useVoiceOrder";
import { useCartStore } from "@/lib/cartStore";
import { VOICE_LANGUAGES } from "@/lib/constants";
import { cn } from "@/lib/utils";

function voiceLangBadgeLabel(lang: string): string {
  const known = VOICE_LANGUAGES.find((l) => l.value === lang);
  if (known) return known.label;
  if (lang === "te-IN") return "తెలుగు";
  if (lang === "kn-IN") return "ಕನ್ನಡ";
  if (lang === "ta-IN") return "தமிழ்";
  return lang;
}

const ERROR_MESSAGES: Record<string, string> = {
  stt_unsupported: "Voice not supported — use the grid below",
  webspeech_error: "Voice error — try again or use the grid below",
  parse_failed: "Could not understand order — tap items below",
  mic_denied: "Microphone blocked — allow access or use the grid",
  unsupported_lang: "Language not supported for voice",
  use_webspeech: "Use English or Hindi for voice on this device",
  transcribe_failed: "Could not transcribe — try again or use the grid",
  stt_degraded: "Voice quality low — use the grid below",
  empty_transcript: "Did not catch that — try again",
  network_error: "No internet for voice — check connection or use the grid",
  no_speech_detected: "No speech heard — speak clearly and retry",
  lang_not_supported_stt: "This language is not supported by your browser — try Chrome or use the grid",
  voice_aborted: "Voice cancelled — tap to start again",
};

function mapError(reason: string | null): string {
  if (!reason) return "Something went wrong — use the grid below";
  return ERROR_MESSAGES[reason] ?? "Something went wrong — use the grid below";
}

type VoiceCoreProps = {
  voiceLang: string;
  onScheduleReset: () => void;
  onNeedsConfirmationChange?: (flag: boolean) => void;
};

function VoiceOrderButtonCore({ voiceLang, onScheduleReset, onNeedsConfirmationChange }: VoiceCoreProps) {
  const setItemsFromVoice = useCartStore((s) => s.setItemsFromVoice);
  const {
    startListening,
    stopListening,
    state,
    lastTranscript,
    parsedItems,
    unmatched,
    needsConfirmation,
    errorReason,
  } = useVoiceOrder({ voiceLang });

  const appliedVoiceSigRef = useRef<string>("");

  useEffect(() => {
    onNeedsConfirmationChange?.(needsConfirmation);
  }, [needsConfirmation, onNeedsConfirmationChange]);

  useEffect(() => {
    if (parsedItems.length === 0) appliedVoiceSigRef.current = "";
  }, [parsedItems.length]);

  useEffect(() => {
    if (state !== "success" || parsedItems.length === 0) return;
    const sig = JSON.stringify(parsedItems);
    if (appliedVoiceSigRef.current === sig) return;
    appliedVoiceSigRef.current = sig;
    setItemsFromVoice(parsedItems);
  }, [state, parsedItems, setItemsFromVoice]);

  useEffect(() => {
    if (state !== "success") return;
    const t = window.setTimeout(onScheduleReset, 1500);
    return () => window.clearTimeout(t);
  }, [state, onScheduleReset]);

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const label =
    state === "idle"
      ? "Start voice order"
      : state === "listening"
        ? "Listening — tap to stop"
        : state === "transcribing"
          ? "Transcribing audio"
          : state === "parsing"
            ? "Understanding order"
            : state === "success"
              ? "Order understood"
              : state === "error"
                ? mapError(errorReason)
                : "Voice order";

  const langLabel = voiceLangBadgeLabel(voiceLang);

  return (
    <section className="flex flex-col items-center gap-2" aria-labelledby="voice-order-heading">
      <h2 id="voice-order-heading" className="sr-only">
        Voice order
      </h2>
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
        aria-label={`Voice language: ${langLabel}`}
      >
        <span aria-hidden>🎙️</span>
        <span>{langLabel}</span>
      </div>
      {unmatched.length > 0 ? (
        <p className="w-full text-center text-xs text-muted-foreground">
          Not on menu: {unmatched.join(", ")}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (state === "listening") stopListening();
          else startListening();
        }}
        aria-label={label}
        aria-pressed={state === "listening"}
        className={cn(
          "relative flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full shadow-md ring-4 ring-offset-2 ring-offset-background transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:transition-colors",
          state === "idle" && "bg-primary text-primary-foreground ring-transparent",
          state === "listening" &&
            "bg-destructive text-destructive-foreground ring-2 ring-white/90 motion-safe:animate-pulse",
          state === "listening" && reducedMotion && "motion-safe:animate-none",
          (state === "transcribing" || state === "parsing") &&
            "bg-purple-600 text-white ring-purple-300 dark:bg-purple-700",
          state === "success" && "bg-green-600 text-white ring-green-300",
          state === "error" && "bg-muted text-muted-foreground ring-border",
        )}
      >
        {state === "idle" || state === "listening" ? (
          <Mic className="h-9 w-9" strokeWidth={state === "listening" ? 2.5 : 2} aria-hidden />
        ) : null}
        {state === "transcribing" || state === "parsing" ? (
          <Loader2 className="h-9 w-9 animate-spin" aria-hidden />
        ) : null}
        {state === "success" ? <Check className="h-9 w-9" aria-hidden /> : null}
        {state === "error" ? <AlertCircle className="h-9 w-9" aria-hidden /> : null}
      </button>
      <div className="min-h-[3rem] w-full max-w-sm text-center">
        {state === "error" ? (
          <p role="alert" aria-live="assertive" className="text-sm font-medium text-muted-foreground">
            {mapError(errorReason)}
          </p>
        ) : (
          <p aria-live="polite" aria-atomic="true" className={cn("text-sm font-medium", state === "listening" && "text-destructive")}>
            {state === "idle" ? "Tap to speak" : null}
            {state === "listening" ? "Listening…" : null}
            {state === "transcribing" ? "Hearing you…" : null}
            {state === "parsing" ? "Understanding…" : null}
            {state === "success" ? "Got it!" : null}
          </p>
        )}
        {lastTranscript ? (
          <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{lastTranscript}&rdquo;</p>
        ) : null}
      </div>
    </section>
  );
}

export type VoiceOrderButtonProps = {
  voiceLang: string;
  onNeedsConfirmationChange?: (flag: boolean) => void;
};

export function VoiceOrderButton({ voiceLang, onNeedsConfirmationChange }: VoiceOrderButtonProps) {
  const [tick, setTick] = useState(0);
  return (
    <VoiceOrderButtonCore
      key={tick}
      voiceLang={voiceLang}
      onScheduleReset={() => setTick((t) => t + 1)}
      onNeedsConfirmationChange={onNeedsConfirmationChange}
    />
  );
}
