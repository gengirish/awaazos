/**
 * Self-hosted Whisper STT adapter (faster-whisper service on Fly).
 *
 *   POST ${WHISPER_STT_URL}/v1/transcribe
 *   Authorization: Bearer ${WHISPER_STT_SECRET}
 *   multipart/form-data:
 *     file     = <audio blob>
 *     language = "en" | "hi" | "te" | "kn" | "ta"   (ISO-639-1)
 *
 * Slot in the cascade: last-resort STT for ALL languages when
 * `WHISPER_STT_URL` is configured. Intended as a cost/ops escape hatch
 * (self-hosted GPU on Fly) — not primary until golden STT pass rates match
 * Sarvam/OpenAI on `tests/golden/stt`.
 *
 * Privacy: audio stays on infrastructure we control. No third-party ASR
 * when this tier handles the request.
 */

const STT_TIMEOUT_MS = 8_000;

export type WhisperSttLang = "en-IN" | "hi-IN" | "te-IN" | "kn-IN" | "ta-IN";

const LANG_MAP: Record<WhisperSttLang, string> = {
  "en-IN": "en",
  "hi-IN": "hi",
  "te-IN": "te",
  "kn-IN": "kn",
  "ta-IN": "ta",
};

type WhisperTranscriptionResponse = {
  text?: string;
  confidence?: number;
};

export function whisperSttConfigured(): boolean {
  const url = process.env.WHISPER_STT_URL;
  const secret = process.env.WHISPER_STT_SECRET;
  return (
    typeof url === "string" &&
    url.startsWith("http") &&
    typeof secret === "string" &&
    secret.length >= 16
  );
}

function baseUrl(): string {
  const url = process.env.WHISPER_STT_URL?.trim();
  if (!url) throw new Error("WHISPER_STT_URL is not configured");
  return url.replace(/\/$/, "");
}

function authSecret(): string {
  const secret = process.env.WHISPER_STT_SECRET?.trim();
  if (!secret) throw new Error("WHISPER_STT_SECRET is not configured");
  return secret;
}

export async function transcribeAudio(
  audio: Blob,
  lang: WhisperSttLang,
): Promise<{ transcript: string; confidence: number }> {
  const language = LANG_MAP[lang];
  const body = new FormData();
  body.append("file", audio, "recording.webm");
  body.append("language", language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl()}/v1/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret()}`,
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Whisper STT HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await res.json()) as WhisperTranscriptionResponse;
    const transcript = typeof data.text === "string" ? data.text : "";
    const confidence =
      typeof data.confidence === "number" && Number.isFinite(data.confidence)
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.85;

    return { transcript, confidence };
  } finally {
    clearTimeout(timeout);
  }
}
