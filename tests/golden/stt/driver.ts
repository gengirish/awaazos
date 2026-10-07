/**
 * Provider-agnostic driver for golden STT tests.
 *
 * Reuses production adapters in lib/*-stt.ts so drift in timeout, lang mapping,
 * or request shape is caught automatically.
 */

import { transcribeAudio as transcribeViaGroq, type GroqSttLang } from "@/lib/groq-stt";
import {
  transcribeAudio as transcribeViaOpenai,
  type OpenaiSttLang,
} from "@/lib/openai-stt";
import { transcribeAudio as transcribeViaSarvam, type SarvamLang } from "@/lib/sarvam";
import {
  transcribeAudio as transcribeViaWhisper,
  whisperSttConfigured,
  type WhisperSttLang,
} from "@/lib/whisper-stt";

export type SttProvider = "sarvam" | "openai" | "groq" | "whisper";

export interface SttProviderRunResult {
  provider: SttProvider;
  latencyMs: number;
  transcript: string;
  confidence: number;
}

export class SttProviderNotConfiguredError extends Error {
  constructor(public readonly provider: SttProvider) {
    super(`Provider "${provider}" is not configured (missing API key / URL).`);
    this.name = "SttProviderNotConfiguredError";
  }
}

type SupportedLang = GroqSttLang & OpenaiSttLang & SarvamLang & WhisperSttLang;

function openaiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return typeof key === "string" && key.startsWith("sk-");
}

function groqConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return typeof key === "string" && key.startsWith("gsk_");
}

function sarvamConfigured(): boolean {
  const key = process.env.SARVAM_API_KEY;
  return typeof key === "string" && key.length > 0;
}

export function isSttProviderConfigured(provider: SttProvider): boolean {
  switch (provider) {
    case "sarvam":
      return sarvamConfigured();
    case "openai":
      return openaiConfigured();
    case "groq":
      return groqConfigured();
    case "whisper":
      return whisperSttConfigured();
  }
}

export const ALL_STT_PROVIDERS: SttProvider[] = [
  "sarvam",
  "openai",
  "groq",
  "whisper",
];

export async function dispatchSttProvider(
  provider: SttProvider,
  audio: Blob,
  lang: string,
): Promise<SttProviderRunResult> {
  if (!isSttProviderConfigured(provider)) {
    throw new SttProviderNotConfiguredError(provider);
  }

  const t0 = Date.now();
  let out: { transcript: string; confidence: number };

  switch (provider) {
    case "sarvam":
      out = await transcribeViaSarvam(audio, lang as SarvamLang);
      break;
    case "openai":
      out = await transcribeViaOpenai(audio, lang as OpenaiSttLang);
      break;
    case "groq":
      out = await transcribeViaGroq(audio, lang as GroqSttLang);
      break;
    case "whisper":
      out = await transcribeViaWhisper(audio, lang as WhisperSttLang);
      break;
  }

  return {
    provider,
    latencyMs: Date.now() - t0,
    transcript: out.transcript,
    confidence: out.confidence,
  };
}

export function resolveSttProvidersFromEnv(
  defaultProviders: SttProvider[] = ["groq"],
): SttProvider[] {
  const list = process.env.GOLDEN_STT_PROVIDERS;
  const single = process.env.GOLDEN_STT_PROVIDER;
  let raw: string[];

  if (list?.trim()) raw = list.split(",").map((s) => s.trim());
  else if (single?.trim()) raw = [single.trim()];
  else return defaultProviders;

  const known = new Set<string>(ALL_STT_PROVIDERS);
  return raw.filter((s): s is SttProvider => known.has(s));
}

export function langSupportedByProvider(provider: SttProvider, lang: string): boolean {
  if (provider === "sarvam") {
    return (["te-IN", "kn-IN", "ta-IN"] as const).includes(lang as SarvamLang);
  }
  if (provider === "openai") {
    return (["en-IN", "hi-IN"] as const).includes(lang as OpenaiSttLang);
  }
  return (["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"] as const).includes(
    lang as SupportedLang,
  );
}
