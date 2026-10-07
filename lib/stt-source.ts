/** Every engine that can produce a voice transcript. "webspeech" runs in the browser; the rest are the server cascade. */
export const STT_SOURCES = ["webspeech", "sarvam", "openai", "groq", "whisper"] as const;

export type SttSource = (typeof STT_SOURCES)[number];

/** Providers reachable through POST /api/ai/transcribe. */
export type ServerSttSource = Exclude<SttSource, "webspeech">;
