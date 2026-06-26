"use client";

import { useCallback, useRef, useState } from "react";

import { mapWebSpeechErrorCode, type VoiceErrorReason } from "@/lib/voice-error";

type VoiceOrderState =
  | "idle"
  | "listening"
  | "transcribing"
  | "parsing"
  | "success"
  | "error";

type SttSource = "webspeech" | "sarvam" | "openai" | "groq" | "nvidia";

type ParsedItem = {
  menuItemId: string;
  name: string;
  priceInPaise: number;
  qty: number;
};

interface WebSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((this: WebSpeechRecognition, ev: VoiceSpeechRecognitionEvent) => void) | null;
  onerror: ((this: WebSpeechRecognition, ev: VoiceSpeechErrorEvent) => void) | null;
  onend: ((this: WebSpeechRecognition, ev: Event) => void) | null;
}

interface VoiceSpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface VoiceSpeechErrorEvent extends Event {
  error: string;
  message?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): WebSpeechRecognition };
    webkitSpeechRecognition?: { new (): WebSpeechRecognition };
  }
}

const SARVAM_LANGS = new Set(["te-IN", "kn-IN", "ta-IN"]);
const WEBSPEECH_LANGS = new Set(["en-IN", "hi-IN"]);
const FALLBACK_LANGS = new Set(["en-IN", "hi-IN"]);

// Build-time public flag. When `true`, hi-IN/en-IN are routed through the
// MediaRecorder + /api/ai/transcribe path (server picks OpenAI > NVIDIA based
// on which key is configured) instead of the in-browser Web Speech API.
// Set on Vercel for A/B testing.
//
// Backward compatible: NEXT_PUBLIC_VOICE_NVIDIA_FALLBACK still works for
// rollouts that haven't been migrated yet.
const VOICE_FALLBACK_ENABLED =
  process.env.NEXT_PUBLIC_VOICE_FALLBACK_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_VOICE_NVIDIA_FALLBACK === "true";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export function useVoiceOrder(options: { voiceLang: string }) {
  const { voiceLang } = options;
  const [state, setState] = useState<VoiceOrderState>("idle");
  const [lastTranscript, setLastTranscript] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<VoiceErrorReason | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);
  const parseGenerationRef = useRef(0);

  const needsConfirmation = confidence === "low";

  const parseTranscript = useCallback(async (transcript: string, sttSource: SttSource) => {
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    const generation = ++parseGenerationRef.current;

    setState("parsing");
    setLastTranscript(transcript);
    try {
      const res = await fetch("/api/ai/parse-order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, lang: voiceLang, sttSource }),
        signal: controller.signal,
      });
      if (generation !== parseGenerationRef.current) return;
      if (res.status === 429) {
        setState("error");
        setErrorReason("network_error");
        return;
      }
      if (!res.ok) {
        setState("error");
        setErrorReason("parse_failed");
        return;
      }
      const data = (await res.json()) as {
        items: ParsedItem[];
        unmatched: string[];
        confidence: "high" | "medium" | "low";
        modelUsed: string;
      };
      if (generation !== parseGenerationRef.current) return;
      setParsedItems(data.items);
      setUnmatched(data.unmatched);
      setConfidence(data.confidence);
      setModelUsed(data.modelUsed);
      if (data.items.length === 0) {
        setState("error");
        setErrorReason(data.unmatched.length > 0 ? "parse_failed" : "empty_transcript");
        return;
      }
      setState("success");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (generation !== parseGenerationRef.current) return;
      setState("error");
      setErrorReason("parse_failed");
    }
  }, [voiceLang]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startListening = useCallback(async () => {
    if (state === "parsing" || state === "transcribing") return;

    setErrorReason(null);
    setParsedItems([]);
    setUnmatched([]);
    setConfidence(null);
    setModelUsed(null);

    // Recorder path is used for: Sarvam langs always, NVIDIA langs only when
    // the public fallback flag is on. Web Speech path is the default for
    // hi-IN/en-IN unless the flag flips it.
    const useRecorder =
      SARVAM_LANGS.has(voiceLang) ||
      (VOICE_FALLBACK_ENABLED && FALLBACK_LANGS.has(voiceLang));

    if (!useRecorder && WEBSPEECH_LANGS.has(voiceLang)) {
      const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Ctor) {
        setState("error");
        setErrorReason("stt_unsupported");
        return;
      }

      const recognition = new Ctor();
      recognition.lang = voiceLang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (ev: VoiceSpeechRecognitionEvent) => {
        const text = ev.results[0]?.[0]?.transcript?.trim() ?? "";
        if (text) void parseTranscript(text, "webspeech");
        else {
          setState("idle");
        }
      };

      recognition.onerror = (ev: VoiceSpeechErrorEvent) => {
        const reason = mapWebSpeechErrorCode(ev.error);
        if (typeof console !== "undefined") {
          console.warn(
            JSON.stringify({
              event: "webspeech_error",
              code: ev.error || "unknown",
              message: ev.message || "",
              reason,
              voiceLang,
            }),
          );
        }
        if (reason === "voice_aborted") {
          setState("idle");
          return;
        }
        setState("error");
        setErrorReason(reason);
      };

      recognition.onend = () => {
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      setState("listening");
      try {
        recognition.start();
      } catch {
        setState("error");
        setErrorReason("webspeech_error");
      }
      return;
    }

    if (useRecorder) {
      setState("listening");
      chunksRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mimeType = pickMimeType();
        const mr = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = mr;

        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mr.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          mediaRecorderRef.current = null;

          const blob = new Blob(chunksRef.current, {
            type: mr.mimeType || "audio/webm",
          });
          chunksRef.current = [];

          void (async () => {
            setState("transcribing");
            const form = new FormData();
            form.append("audio", blob, "clip.webm");
            form.append("lang", voiceLang);

            try {
              const res = await fetch("/api/ai/transcribe", {
                method: "POST",
                credentials: "include",
                body: form,
              });
              const data = (await res.json()) as {
                transcript?: string;
                error?: string;
                fallback?: string;
                sttSource?: SttSource;
              };

              if (!res.ok && res.status === 400) {
                setState("error");
                setErrorReason("use_webspeech");
                return;
              }

              if (data.error && !data.transcript) {
                setState("error");
                setErrorReason(data.fallback === "quickadd" ? "stt_degraded" : "transcribe_failed");
                return;
              }

              const transcript = typeof data.transcript === "string" ? data.transcript.trim() : "";
              if (!transcript) {
                setState("error");
                setErrorReason("empty_transcript");
                return;
              }

              // Server tells us which engine handled the audio; fall back to
              // a sensible default keyed on the lang group if the field is
              // absent (older deploy still in flight, browser cache, etc.).
              // For fallback langs we now prefer OpenAI; NVIDIA is legacy.
              const reportedSource: SttSource =
                data.sttSource ?? (SARVAM_LANGS.has(voiceLang) ? "sarvam" : "openai");
              await parseTranscript(transcript, reportedSource);
            } catch {
              setState("error");
              setErrorReason("transcribe_failed");
            }
          })();
        };

        mr.start();
        setTimeout(() => {
          if (mediaRecorderRef.current === mr && mr.state === "recording") {
            mr.stop();
          }
        }, 12_000);
      } catch {
        setState("error");
        setErrorReason("mic_denied");
      }
      return;
    }

    setState("error");
    setErrorReason("unsupported_lang");
  }, [parseTranscript, state, voiceLang]);

  return {
    startListening,
    stopListening,
    state,
    lastTranscript,
    parsedItems,
    unmatched,
    confidence,
    modelUsed,
    needsConfirmation,
    errorReason,
  };
}
