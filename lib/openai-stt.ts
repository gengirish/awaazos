import { requireEnv } from "@/lib/env";

/**
 * OpenAI Speech-to-Text adapter (gpt-4o-mini-transcribe, REST multipart).
 *
 *   POST https://api.openai.com/v1/audio/transcriptions
 *   Authorization: Bearer sk-...
 *   multipart/form-data:
 *     file     = <audio blob, ≤ 25 MB>
 *     model    = "gpt-4o-mini-transcribe"
 *     language = "hi" | "en"          (ISO-639-1, optional but improves accuracy)
 *     response_format = "json"
 *     include[] = "logprobs"           (gives us a real confidence number)
 *
 * Currently used as the en-IN / hi-IN fallback when Web Speech can't be used.
 * te-IN / kn-IN / ta-IN stay on Sarvam — Sarvam wins on Indian code-mixing
 * (Hinglish / Tamlish / brand names dropped into Hindi sentences).
 *
 * Mini-only by deliberate choice. No two-tier escalation. The route caller
 * controls the model only by env override (rare).
 *
 * Privacy: audio bytes are streamed and not persisted on our side. ZDR
 * (Zero Data Retention) MUST be active on the OpenAI org before any vendor
 * traffic reaches this code path.
 */

const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const STT_TIMEOUT_MS = 5_000;

const DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe";

export type OpenaiSttLang = "en-IN" | "hi-IN";

const LANG_MAP: Record<OpenaiSttLang, string> = {
  // OpenAI accepts ISO-639-1 base codes ("en", "hi"); region tags are ignored
  // by the model. Pass the base code to avoid spurious "unknown language"
  // warnings in the response logs.
  "en-IN": "en",
  "hi-IN": "hi",
};

type LogprobToken = {
  token?: string;
  logprob?: number;
};

type OpenaiTranscriptionResponse = {
  text?: string;
  logprobs?: LogprobToken[] | null;
  usage?:
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | { seconds?: number; type?: string }
    | null;
};

/**
 * Convert an array of token logprobs to a 0..1 confidence score.
 * Mean-of-exp(logprob) collapses to a token-likelihood average; clamped so
 * downstream code never sees NaN/Inf even on weird responses.
 */
function logprobsToConfidence(logprobs: LogprobToken[] | null | undefined): number {
  if (!logprobs || logprobs.length === 0) return 0.85;
  let sum = 0;
  let n = 0;
  for (const t of logprobs) {
    if (typeof t.logprob === "number" && Number.isFinite(t.logprob)) {
      sum += Math.exp(t.logprob);
      n += 1;
    }
  }
  if (n === 0) return 0.85;
  const mean = sum / n;
  if (!Number.isFinite(mean)) return 0.85;
  return Math.max(0, Math.min(1, mean));
}

export async function transcribeAudio(
  audio: Blob,
  lang: OpenaiSttLang,
): Promise<{ transcript: string; confidence: number }> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = (process.env.OPENAI_STT_MODEL || DEFAULT_STT_MODEL).trim();
  const language = LANG_MAP[lang];

  const body = new FormData();
  body.append("file", audio, "recording.webm");
  body.append("model", model);
  body.append("language", language);
  body.append("response_format", "json");
  body.append("include[]", "logprobs");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_STT_URL, {
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
        `OpenAI STT HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await res.json()) as OpenaiTranscriptionResponse;
    const transcript = typeof data.text === "string" ? data.text : "";
    const confidence = logprobsToConfidence(data.logprobs);

    return { transcript, confidence };
  } finally {
    clearTimeout(timeout);
  }
}
