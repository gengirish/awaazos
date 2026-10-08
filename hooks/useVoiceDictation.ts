"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  SARVAM_LANGS,
  VOICE_FALLBACK_ENABLED,
  WEBSPEECH_LANGS,
  pickMimeType,
  type VoiceSpeechErrorEvent,
  type WebSpeechRecognition,
} from "@/hooks/useVoiceOrder";
import type { SttSource } from "@/lib/stt-source";
import { mapWebSpeechErrorCode, type VoiceErrorReason } from "@/lib/voice-error";

/**
 * Free-form dictation (a whole sentence, not a short POS order).
 *
 * Capture only — STT, never NLU. Same routing as `useVoiceOrder`:
 * - en-IN / hi-IN → Web Speech in the browser (unless
 *   NEXT_PUBLIC_VOICE_FALLBACK_ENABLED flips them to the server cascade);
 * - te-IN / kn-IN / ta-IN → MediaRecorder → POST /api/ai/transcribe.
 *
 * The final transcript is handed to `onTranscript`; while that promise runs the
 * state is "parsing". If it resolves to an error code the hook ends in "error"
 * with that code, so the caller owns NLU errors without a second state machine.
 */

export type DictationState = "idle" | "listening" | "transcribing" | "parsing" | "error";

/**
 * Capture-side reasons from `VoiceErrorReason`, plus `voice_unavailable`: the
 * transcribe cascade answered `fallback: "quickadd"` (or a plan gate) — voice is
 * off for now, use the form. Callers may return their own codes from `onTranscript`.
 */
export type DictationError = VoiceErrorReason | "voice_unavailable" | (string & {});

export type UseVoiceDictationOptions = {
  voiceLang: string;
  /** Final transcript → caller's NLU. Resolve to an error code to end in "error". */
  onTranscript: (transcript: string, sttSource: SttSource) => Promise<DictationError | void> | DictationError | void;
  /** Hard stop for a single take. Default 30 s. */
  maxMs?: number;
};

/** Web Speech result list → text. `continuous` sessions append one result per phrase. */
function joinResults(results: SpeechRecognitionResultList, finalOnly: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (finalOnly && !r.isFinal) continue;
    const text = r[0]?.transcript?.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

type ResultEvent = Event & { results: SpeechRecognitionResultList };

export function useVoiceDictation({ voiceLang, onTranscript, maxMs = 30_000 }: UseVoiceDictationOptions) {
  const [state, setState] = useState<DictationState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<DictationError | null>(null);

  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const generationRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const fail = useCallback((reason: DictationError) => {
    busyRef.current = false;
    setError(reason);
    setState("error");
  }, []);

  const finish = useCallback(
    async (text: string, source: SttSource, generation: number) => {
      if (generation !== generationRef.current) return;
      const clean = text.trim();
      if (!clean) {
        fail("empty_transcript");
        return;
      }
      setTranscript(clean);
      setState("parsing");
      try {
        const result = await onTranscriptRef.current(clean, source);
        if (generation !== generationRef.current) return;
        if (result) fail(result);
        else {
          busyRef.current = false;
          setState("idle");
        }
      } catch {
        if (generation === generationRef.current) fail("parse_failed");
      }
    },
    [fail],
  );

  const stop = useCallback(() => {
    clearTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Release the mic if the component goes away mid-take.
  useEffect(
    () => () => {
      generationRef.current++;
      clearTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const startWebSpeech = useCallback(
    (generation: number) => {
      const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Ctor) {
        fail("stt_unsupported");
        return;
      }
      const rec = new Ctor();
      rec.lang = voiceLang;
      // A drop is a long sentence with pauses ("…150 rupaye, 15 thepla, pickup…"):
      // keep listening across pauses until the vendor taps stop or maxMs passes.
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      let finalText = "";
      let errored = false;

      rec.onresult = (ev) => {
        const results = (ev as unknown as ResultEvent).results;
        finalText = joinResults(results, true);
        // Live text for confirmation: finals plus the phrase still being heard.
        setTranscript(joinResults(results, false));
      };
      rec.onerror = (ev: VoiceSpeechErrorEvent) => {
        const reason = mapWebSpeechErrorCode(ev.error);
        // Silence after real speech is the normal end of a take — onend finishes it.
        if (reason === "no_speech_detected" && finalText) return;
        errored = true;
        if (generation !== generationRef.current) return;
        if (reason === "voice_aborted") {
          busyRef.current = false;
          setState("idle");
          return;
        }
        fail(reason);
      };
      rec.onend = () => {
        clearTimer();
        recognitionRef.current = null;
        if (errored) return;
        void finish(finalText, "webspeech", generation);
      };

      recognitionRef.current = rec;
      setState("listening");
      try {
        rec.start();
        timerRef.current = window.setTimeout(stop, maxMs);
      } catch {
        recognitionRef.current = null;
        fail("webspeech_error");
      }
    },
    [fail, finish, maxMs, stop, voiceLang],
  );

  const startRecorder = useCallback(
    async (generation: number) => {
      setState("listening");
      const chunks: BlobPart[] = [];
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (generation === generationRef.current) fail("mic_denied");
        return;
      }
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mr.onstop = () => {
        clearTimer();
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (generation !== generationRef.current) return;
        // Audio is streamed to the server and discarded — never stored here either.
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        void (async () => {
          setState("transcribing");
          const form = new FormData();
          form.append("audio", blob, "clip.webm");
          form.append("lang", voiceLang);
          try {
            const res = await fetch("/api/ai/transcribe", { method: "POST", credentials: "include", body: form });
            const data = (await res.json().catch(() => ({}))) as {
              transcript?: string;
              error?: string;
              fallback?: string;
              sttSource?: SttSource;
            };
            if (generation !== generationRef.current) return;
            if (res.status === 400 && data.error === "use_webspeech") return fail("use_webspeech");
            if (res.status === 402 || data.fallback === "quickadd") return fail("voice_unavailable");
            if (res.status === 429) return fail("rate_limited");
            if (!res.ok || (data.error && !data.transcript)) return fail("transcribe_failed");
            const source: SttSource = data.sttSource ?? (SARVAM_LANGS.has(voiceLang) ? "sarvam" : "openai");
            await finish(typeof data.transcript === "string" ? data.transcript : "", source, generation);
          } catch {
            if (generation === generationRef.current) fail("network_error");
          }
        })();
      };
      mr.start();
      timerRef.current = window.setTimeout(stop, maxMs);
    },
    [fail, finish, maxMs, stop, voiceLang],
  );

  const start = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = ++generationRef.current;
    setError(null);
    setTranscript("");

    const useRecorder = SARVAM_LANGS.has(voiceLang) || (VOICE_FALLBACK_ENABLED && WEBSPEECH_LANGS.has(voiceLang));
    if (useRecorder) {
      void startRecorder(generation);
      return;
    }
    if (WEBSPEECH_LANGS.has(voiceLang)) {
      startWebSpeech(generation);
      return;
    }
    fail("unsupported_lang");
  }, [fail, startRecorder, startWebSpeech, voiceLang]);

  /** Back to idle and forget the transcript (does not touch the caller's state). */
  const reset = useCallback(() => {
    generationRef.current++;
    busyRef.current = false;
    clearTimer();
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    setTranscript("");
    setError(null);
    setState("idle");
  }, []);

  return { state, transcript, error, start, stop, reset };
}
