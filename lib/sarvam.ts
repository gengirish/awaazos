import { requireEnv } from "@/lib/env";

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const STT_TIMEOUT_MS = 5_000;

export type SarvamLang = "te-IN" | "kn-IN" | "ta-IN";

type SarvamSpeechToTextResponse = {
  request_id?: string | null;
  transcript: string;
  language_code?: string | null;
  language_probability?: number | null;
};

/**
 * Sarvam Saaras STT (REST). API key is read only when this runs (not at module load).
 */
export async function transcribeAudio(
  audio: Blob,
  lang: SarvamLang,
): Promise<{ transcript: string; confidence: number }> {
  const apiKey = requireEnv("SARVAM_API_KEY");

  const body = new FormData();
  body.append("file", audio, "recording.webm");
  body.append("model", "saaras:v2");
  body.append("language_code", lang);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const res = await fetch(SARVAM_STT_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Sarvam STT HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
    }

    const data = (await res.json()) as SarvamSpeechToTextResponse;
    const transcript = typeof data.transcript === "string" ? data.transcript : "";
    const confidence =
      typeof data.language_probability === "number" ? data.language_probability : 0.85;

    return { transcript, confidence };
  } finally {
    clearTimeout(timeout);
  }
}
