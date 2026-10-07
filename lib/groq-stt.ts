import { requireEnv } from "@/lib/env";

/**
 * Groq Speech-to-Text adapter (whisper-large-v3-turbo, REST multipart).
 *
 *   POST https://api.groq.com/openai/v1/audio/transcriptions
 *   Authorization: Bearer gsk_...
 *   multipart/form-data:
 *     file     = <audio blob, ≤ 25 MB on free tier, 100 MB on dev>
 *     model    = "whisper-large-v3-turbo"
 *     language = "en" | "hi" | "te" | "kn" | "ta"   (ISO-639-1)
 *     response_format = "json"
 *     temperature = 0
 *
 * Slot in the cascade: layer-2 STT for ALL languages.
 *   te-IN/kn-IN/ta-IN  : Sarvam primary  → Groq fallback
 *   en-IN/hi-IN        : OpenAI primary → Groq fallback
 *
 * Whisper does not return logprobs, so confidence is a fixed baseline (0.85),
 * matching the Sarvam adapter.
 *
 * Privacy: Groq runs on US infrastructure. No public Zero-Data-Retention
 * tier as of writing. This adapter MUST stay dormant on production until
 * a DPDP-compliant agreement is in place with Groq, or until the privacy
 * disclosure is updated to make the audio path explicit to vendors.
 */

export function groqSttConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return typeof key === "string" && key.startsWith("gsk_");
}

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const STT_TIMEOUT_MS = 5_000;

const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";

export type GroqSttLang = "en-IN" | "hi-IN" | "te-IN" | "kn-IN" | "ta-IN";

const LANG_MAP: Record<GroqSttLang, string> = {
  "en-IN": "en",
  "hi-IN": "hi",
  "te-IN": "te",
  "kn-IN": "kn",
  "ta-IN": "ta",
};

type GroqTranscriptionResponse = {
  text?: string;
  /**
   * Whisper-large-v3-turbo doesn't return per-token logprobs; the field is
   * accepted defensively in case Groq adds it later or for response_format
   * "verbose_json" upgrades.
   */
  segments?: Array<{ avg_logprob?: number }> | null;
};

function inferConfidence(data: GroqTranscriptionResponse): number {
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    let sum = 0;
    let n = 0;
    for (const s of data.segments) {
      if (typeof s.avg_logprob === "number" && Number.isFinite(s.avg_logprob)) {
        sum += Math.exp(s.avg_logprob);
        n += 1;
      }
    }
    if (n > 0) {
      const mean = sum / n;
      if (Number.isFinite(mean)) return Math.max(0, Math.min(1, mean));
    }
  }
  return 0.85;
}

export async function transcribeAudio(
  audio: Blob,
  lang: GroqSttLang,
): Promise<{ transcript: string; confidence: number }> {
  const apiKey = requireEnv("GROQ_API_KEY");
  const model = (process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL).trim();
  const language = LANG_MAP[lang];

  const body = new FormData();
  body.append("file", audio, "recording.webm");
  body.append("model", model);
  body.append("language", language);
  body.append("response_format", "json");
  body.append("temperature", "0");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Groq STT HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await res.json()) as GroqTranscriptionResponse;
    const transcript = typeof data.text === "string" ? data.text : "";
    const confidence = inferConfidence(data);

    return { transcript, confidence };
  } finally {
    clearTimeout(timeout);
  }
}
