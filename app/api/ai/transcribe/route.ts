import { NextRequest, NextResponse } from "next/server";

import { Plan } from "@prisma/client";

import { reserveOpenaiSttMinutes, reserveSarvamMinutes } from "@/lib/ai-usage-guard";
import { transcribeAudio as transcribeViaSarvam, type SarvamLang } from "@/lib/sarvam";
import { transcribeAudio as transcribeViaNvidia, type NvidiaLang } from "@/lib/nvidia";
import {
  transcribeAudio as transcribeViaOpenai,
  type OpenaiSttLang,
} from "@/lib/openai-stt";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SttSource = "sarvam" | "openai" | "nvidia";

const SARVAM_LANGS = ["te-IN", "kn-IN", "ta-IN"] as const satisfies readonly SarvamLang[];
// en/hi langs share the same set across OpenAI and NVIDIA today; keep one
// canonical list and narrow at the call site.
const FALLBACK_LANGS = ["en-IN", "hi-IN"] as const satisfies readonly (
  | NvidiaLang
  | OpenaiSttLang
)[];

function isSarvamLang(s: string): s is SarvamLang {
  return (SARVAM_LANGS as readonly string[]).includes(s);
}

function isFallbackLang(s: string): s is NvidiaLang & OpenaiSttLang {
  return (FALLBACK_LANGS as readonly string[]).includes(s);
}

function openaiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return typeof key === "string" && key.startsWith("sk-");
}

function nvidiaConfigured(): boolean {
  const key = process.env.NVIDIA_API_KEY;
  return typeof key === "string" && key.startsWith("nvapi-");
}

/**
 * Pick the STT provider for the given language.
 *
 * Priority for en-IN / hi-IN: OpenAI (preferred) → NVIDIA (legacy) → reject.
 * te-IN / kn-IN / ta-IN always go to Sarvam (Parakeet/OpenAI Whisper lose
 * to Sarvam on Indic code-mixing in our internal evals).
 */
function pickProvider(lang: string): SttSource | null {
  if (isSarvamLang(lang)) return "sarvam";
  if (isFallbackLang(lang)) {
    if (openaiConfigured()) return "openai";
    if (nvidiaConfigured()) return "nvidia";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let vendorId = "";
  let lang = "";
  let sttSource: SttSource | null = null;

  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    vendorId = ctx.vendor.id;
    requirePlan(ctx.vendor, Plan.STARTER);

    const aiLimiter = getAiLimiterForPlan(ctx.vendor.plan);
    const burst = await aiLimiter.burst.check(ctx.vendor.id);
    if (!burst.ok) return tooManyRequests(burst, "ai-burst");
    const sustained = await aiLimiter.minute.check(ctx.vendor.id);
    if (!sustained.ok) return tooManyRequests(sustained, "ai");

    const form = await req.formData();
    const audio = form.get("audio");
    lang = typeof form.get("lang") === "string" ? (form.get("lang") as string) : "";

    sttSource = pickProvider(lang);

    if (!sttSource) {
      const fallbackLangs = openaiConfigured() || nvidiaConfigured() ? FALLBACK_LANGS : [];
      return NextResponse.json(
        {
          error: "use_webspeech",
          supportedLangs: [...SARVAM_LANGS, ...fallbackLangs],
        },
        { status: 400 },
      );
    }

    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "Missing audio" }, { status: 400 });
    }

    // Rough estimate: mobile WebM voice captures are often ~32kbps -> ~240KB/min.
    const estimatedMinutes = Math.max(1 / 60, audio.size / 240_000);

    let transcript: string;

    if (sttSource === "sarvam") {
      const usage = await reserveSarvamMinutes({
        vendorId: ctx.vendor.id,
        plan: ctx.vendor.plan,
        estimatedMinutes,
      });
      if (!usage.ok) {
        return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
      }
      ({ transcript } = await transcribeViaSarvam(audio, lang as SarvamLang));
    } else if (sttSource === "openai") {
      const usage = await reserveOpenaiSttMinutes({
        vendorId: ctx.vendor.id,
        plan: ctx.vendor.plan,
        estimatedMinutes,
      });
      if (!usage.ok) {
        return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
      }
      ({ transcript } = await transcribeViaOpenai(audio, lang as OpenaiSttLang));
    } else {
      // NVIDIA: legacy fallback. v0 uses the rate-limiter only as a quota
      // guard. Kept on tree until we're certain OpenAI is durable enough as
      // the primary; reverse priority in pickProvider() if needed.
      ({ transcript } = await transcribeViaNvidia(audio, lang as NvidiaLang));
    }

    const durationMs = Date.now() - started;

    console.log(
      JSON.stringify({
        route: "/api/ai/transcribe",
        vendorId,
        lang,
        sttSource,
        durationMs,
        success: true,
      }),
    );

    return NextResponse.json({ transcript, durationMs, sttSource });
  } catch (err) {
    if (err instanceof PlanGateError) {
      const featureBySource: Record<SttSource, string> = {
        sarvam: "sarvam_stt",
        openai: "openai_stt",
        nvidia: "nvidia_stt",
      };
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: sttSource ? featureBySource[sttSource] : "sarvam_stt",
        },
        { status: err.status },
      );
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : "transcription_failed";
    console.log(
      JSON.stringify({
        route: "/api/ai/transcribe",
        vendorId: vendorId || undefined,
        lang: lang || undefined,
        sttSource,
        durationMs,
        success: false,
      }),
    );

    return NextResponse.json({ error: message, fallback: "quickadd" }, { status: 200 });
  }
}
