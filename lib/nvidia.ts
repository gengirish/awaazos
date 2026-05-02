import { requireEnv } from "@/lib/env";

/**
 * NVIDIA Parakeet ASR (HTTP REST via NVCF).
 *
 * Hosted Parakeet 1.1B RNNT Multilingual exposes both gRPC (default) and an
 * HTTP shim at the NVCF invocation gateway:
 *
 *   POST https://<function-id>.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions
 *   Authorization: Bearer nvapi-...
 *   multipart/form-data: { file, language }
 *
 * Function-id and inference path are env-overridable so we don't need a
 * deploy to swap models if NVIDIA renames the function.
 *
 * Currently used as a non-default fallback for `en-IN` and `hi-IN` only.
 * `te-IN`, `kn-IN`, `ta-IN` stay on Sarvam because the hosted Parakeet
 * multilingual model does NOT publish those language codes.
 */

const STT_TIMEOUT_MS = 5_000;

const DEFAULT_FUNCTION_ID = "71203149-d3b7-4460-8231-1be2543a1fca";

const DEFAULT_INFERENCE_PATH = "/v1/audio/transcriptions";

export type NvidiaLang = "en-IN" | "hi-IN";

const RIVA_LANG_MAP: Record<NvidiaLang, string> = {
  // Parakeet multilingual publishes en-US / en-GB but not en-IN. en-US is the
  // closest-matching general English variant.
  "en-IN": "en-US",
  "hi-IN": "hi-IN",
};

type RivaTranscriptionResponse = {
  text?: string;
  transcript?: string;
  language?: string | null;
  confidence?: number | null;
  segments?: Array<{ text?: string }> | null;
};

function buildUrl(): string {
  const fnId = (process.env.NVIDIA_PARAKEET_FUNCTION_ID || DEFAULT_FUNCTION_ID).trim();
  const path = (process.env.NVIDIA_PARAKEET_INFERENCE_PATH || DEFAULT_INFERENCE_PATH).trim();
  return `https://${fnId}.invocation.api.nvcf.nvidia.com${path.startsWith("/") ? path : `/${path}`}`;
}

function extractTranscript(data: RivaTranscriptionResponse): string {
  if (typeof data.text === "string" && data.text.length > 0) return data.text;
  if (typeof data.transcript === "string" && data.transcript.length > 0) return data.transcript;
  if (Array.isArray(data.segments)) {
    return data.segments
      .map((s) => (typeof s.text === "string" ? s.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export async function transcribeAudio(
  audio: Blob,
  lang: NvidiaLang,
): Promise<{ transcript: string; confidence: number }> {
  const apiKey = requireEnv("NVIDIA_API_KEY");
  const language = RIVA_LANG_MAP[lang];

  const body = new FormData();
  body.append("file", audio, "recording.webm");
  body.append("language", language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(), {
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
        `NVIDIA ASR HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await res.json()) as RivaTranscriptionResponse;
    const transcript = extractTranscript(data);
    const confidence = typeof data.confidence === "number" ? data.confidence : 0.85;

    return { transcript, confidence };
  } finally {
    clearTimeout(timeout);
  }
}
