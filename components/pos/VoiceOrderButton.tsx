"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Languages, Loader2, Mic, RotateCcw, Square } from "lucide-react";

import { useOnline } from "@/hooks/useOnline";
import { useVoiceOrder } from "@/hooks/useVoiceOrder";
import { useCartStore } from "@/lib/cartStore";
import { cn } from "@/lib/utils";
import {
  browserStorage,
  nextVoiceLang,
  readVoiceLangOverride,
  resolveVoiceLang,
  voiceLangLabel,
  writeVoiceLangOverride,
} from "@/lib/voice-lang-pref";

const ERROR_MESSAGES: Record<string, string> = {
  stt_unsupported: "Voice not supported — use the grid below",
  webspeech_error: "Voice error — the grid below also works",
  parse_failed: "Could not understand order — tap items below",
  mic_denied: "Microphone blocked — allow access or use the grid",
  unsupported_lang: "Language not supported for voice",
  use_webspeech: "Use English or Hindi for voice on this device",
  transcribe_failed: "Could not transcribe — the grid below also works",
  stt_degraded: "Voice quality low — use the grid below",
  empty_transcript: "Did not catch that",
  network_error: "No internet for voice — check connection or use the grid",
  no_speech_detected: "No speech heard — speak clearly",
  lang_not_supported_stt: "This language is not supported by your browser — try Chrome or use the grid",
  voice_aborted: "Voice cancelled",
};

function mapError(reason: string | null): string {
  if (!reason) return "Something went wrong — use the grid below";
  return ERROR_MESSAGES[reason] ?? "Something went wrong — use the grid below";
}

type VoiceCoreProps = {
  /** Effective language: the device override if any, else the vendor's saved one. */
  voiceLang: string;
  onCycleLang: () => void;
  onScheduleReset: () => void;
};

function VoiceOrderButtonCore({ voiceLang, onCycleLang, onScheduleReset }: VoiceCoreProps) {
  const setItemsFromVoice = useCartStore((s) => s.setItemsFromVoice);
  const setVoiceReview = useCartStore((s) => s.setVoiceReview);
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
    if (parsedItems.length === 0) appliedVoiceSigRef.current = "";
  }, [parsedItems.length]);

  // Apply each parse result to the cart exactly once. The review warnings go to
  // the store (OrderCart renders them) so they outlive this core remounting.
  useEffect(() => {
    if (state !== "success" || parsedItems.length === 0) return;
    const sig = JSON.stringify(parsedItems);
    if (appliedVoiceSigRef.current === sig) return;
    appliedVoiceSigRef.current = sig;
    setItemsFromVoice(parsedItems);
    setVoiceReview(
      needsConfirmation || unmatched.length > 0
        ? { lowConfidence: needsConfirmation, unmatched: [...unmatched] }
        : null,
    );
  }, [state, parsedItems, unmatched, needsConfirmation, setItemsFromVoice, setVoiceReview]);

  useEffect(() => {
    if (state !== "success") return;
    const t = window.setTimeout(onScheduleReset, 1500);
    return () => window.clearTimeout(t);
  }, [state, onScheduleReset]);

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
                ? // Stable in error: the role="alert" text below carries the message.
                  "Try voice order again"
                : "Voice order";

  const langLabel = voiceLangLabel(voiceLang);
  const busy = state === "listening" || state === "transcribing" || state === "parsing";

  // Web Speech and the parser both need the network; offline, say so up front
  // instead of letting the mic fail slowly. Tap input keeps working.
  const online = useOnline();
  const offlineIdle = !online && (state === "idle" || state === "error" || state === "success");

  // The mic is the retry control after an error, so it must not look disabled.
  const retry = state === "error" && !offlineIdle;

  return (
    // Phones: mic on the left, status + language on the right, so the menu grid
    // starts higher. From md: the centred column (language, mic, status) —
    // `md:contents` lifts the right-hand stack into the column and `order` sorts it.
    <section
      className="flex items-center gap-4 md:flex-col md:gap-2"
      aria-labelledby="voice-order-heading"
    >
      <h2 id="voice-order-heading" className="sr-only">
        Voice order
      </h2>
      <button
        type="button"
        disabled={offlineIdle || state === "parsing" || state === "transcribing"}
        onClick={() => {
          if (state === "listening") stopListening();
          else if (state === "idle" || state === "success" || state === "error") startListening();
        }}
        aria-label={offlineIdle ? "Voice needs internet — tap items below" : label}
        aria-pressed={state === "listening"}
        className={cn(
          "relative flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full shadow-md ring-4 ring-offset-2 ring-offset-background transition-transform focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:transition-colors md:order-2",
          state === "idle" && !offlineIdle && "bg-primary text-primary-foreground ring-transparent",
          offlineIdle && "cursor-not-allowed bg-muted text-muted-foreground ring-border",
          // Listening is the mic working, not an error: primary colour with a
          // halo, a stop square instead of the mic, and the "Listening…" text.
          // `motion-safe:` drops the pulse under prefers-reduced-motion.
          state === "listening" &&
            "bg-primary text-primary-foreground ring-primary/40 motion-safe:animate-pulse",
          (state === "transcribing" || state === "parsing") &&
            "bg-purple-600 text-white ring-purple-300 dark:bg-purple-700 cursor-wait",
          state === "success" && "bg-green-600 text-white ring-green-300",
          retry && "bg-background text-destructive ring-destructive",
        )}
      >
        {state === "idle" ? <Mic className="h-9 w-9" aria-hidden /> : null}
        {state === "listening" ? <Square className="h-8 w-8 fill-current" aria-hidden /> : null}
        {state === "transcribing" || state === "parsing" ? (
          <Loader2 className="h-9 w-9 motion-safe:animate-spin" aria-hidden />
        ) : null}
        {state === "success" ? <Check className="h-9 w-9" aria-hidden /> : null}
        {retry ? <RotateCcw className="h-9 w-9" aria-hidden /> : null}
        {state === "error" && !retry ? <AlertCircle className="h-9 w-9" aria-hidden /> : null}
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 md:contents">
        <div className="w-full text-left md:order-3 md:min-h-12 md:max-w-sm md:text-center">
          {offlineIdle ? (
            <p aria-live="polite" className="text-sm font-medium text-muted-foreground">
              Voice needs internet — tap items below
            </p>
          ) : state === "error" ? (
            <p role="alert" aria-live="assertive" className="text-sm font-medium text-foreground">
              {mapError(errorReason)}
              <span className="block font-normal text-muted-foreground">Tap to try again</span>
            </p>
          ) : (
            <p aria-live="polite" aria-atomic="true" className={cn("text-sm font-medium", state === "listening" && "text-primary")}>
              {state === "idle" ? "Tap to speak" : null}
              {state === "listening" ? "Listening… tap to stop" : null}
              {state === "transcribing" ? "Hearing you…" : null}
              {state === "parsing" ? "Understanding…" : null}
              {state === "success" ? "Got it!" : null}
            </p>
          )}
          {state === "error" && unmatched.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Not on menu: {unmatched.join(", ")}</p>
          ) : null}
          {lastTranscript ? (
            <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{lastTranscript}&rdquo;</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCycleLang}
          disabled={busy}
          aria-label={`Voice language: ${langLabel} — tap to change`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 md:order-1"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          <span>{langLabel}</span>
        </button>
      </div>
    </section>
  );
}

export type VoiceOrderButtonProps = {
  /** The vendor's saved `VendorSettings.voiceLang`. */
  voiceLang: string;
};

export function VoiceOrderButton({ voiceLang: vendorLang }: VoiceOrderButtonProps) {
  const [tick, setTick] = useState(0);
  // Device-local override, read after mount so server and client markup match.
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    setOverride(readVoiceLangOverride(browserStorage()));
  }, []);

  const voiceLang = resolveVoiceLang(override, vendorLang);

  const cycleLang = useCallback(() => {
    const next = nextVoiceLang(voiceLang, vendorLang);
    writeVoiceLangOverride(browserStorage(), next, vendorLang);
    setOverride(next === vendorLang ? null : next);
  }, [voiceLang, vendorLang]);

  const scheduleReset = useCallback(() => setTick((t) => t + 1), []);

  return (
    <VoiceOrderButtonCore
      key={tick}
      voiceLang={voiceLang}
      onCycleLang={cycleLang}
      onScheduleReset={scheduleReset}
    />
  );
}
