import { NextRequest, NextResponse } from "next/server";

import { Plan } from "@prisma/client";

import {
  releaseGroqSttMinutes,
  releaseOpenaiSttMinutes,
  releaseSarvamMinutes,
  reserveGroqSttMinutes,
  reserveOpenaiSttMinutes,
  reserveSarvamMinutes,
} from "@/lib/ai-usage-guard";
import { getBreaker } from "@/lib/circuit-breaker";
import { transcribeAudio as transcribeViaSarvam, type SarvamLang } from "@/lib/sarvam";
import { transcribeAudio as transcribeViaNvidia, type NvidiaLang } from "@/lib/nvidia";
import {
  transcribeAudio as transcribeViaOpenai,
  type OpenaiSttLang,
} from "@/lib/openai-stt";
import {
  transcribeAudio as transcribeViaGroq,
  type GroqSttLang,
} from "@/lib/groq-stt";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SttSource = "sarvam" | "openai" | "nvidia" | "groq";

const SARVAM_LANGS = ["te-IN", "kn-IN", "ta-IN"] as const satisfies readonly SarvamLang[];
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

function groqConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return typeof key === "string" && key.startsWith("gsk_");
}

/**
 * Build the per-language provider cascade.
 *
 * te/kn/ta:    Sarvam → Groq          (Sarvam wins on Indic code-mixing,
 *                                       Groq is a multilingual safety net)
 * en/hi:       OpenAI → Groq → NVIDIA (OpenAI = best WER, Groq = decorrelated
 *                                       cloud, NVIDIA = legacy)
 *
 * Each step is gated by its own circuit breaker. Tripped breakers are skipped
 * with no upstream call so cascades degrade instantly when a provider is hot.
 */
function buildCascade(lang: string): SttSource[] {
  const out: SttSource[] = [];
  if (isSarvamLang(lang)) {
    out.push("sarvam");
    if (groqConfigured()) out.push("groq");
  } else if (isFallbackLang(lang)) {
    if (openaiConfigured()) out.push("openai");
    if (groqConfigured()) out.push("groq");
    if (nvidiaConfigured()) out.push("nvidia");
  }
  return out;
}

type AttemptResult =
  | { ok: true; provider: SttSource; transcript: string; durationMs: number }
  | { ok: false; provider: SttSource; reason: "breaker_open" | "quota" | "error"; code?: string; message?: string };

async function callProvider(
  provider: SttSource,
  audio: Blob,
  lang: string,
): Promise<{ transcript: string }> {
  switch (provider) {
    case "sarvam":
      return transcribeViaSarvam(audio, lang as SarvamLang);
    case "openai":
      return transcribeViaOpenai(audio, lang as OpenaiSttLang);
    case "groq":
      return transcribeViaGroq(audio, lang as GroqSttLang);
    case "nvidia":
      return transcribeViaNvidia(audio, lang as NvidiaLang);
  }
}

async function reserveQuota(
  provider: SttSource,
  vendorId: string,
  plan: Plan,
  estimatedMinutes: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  switch (provider) {
    case "sarvam":
      return reserveSarvamMinutes({ vendorId, plan, estimatedMinutes });
    case "openai":
      return reserveOpenaiSttMinutes({ vendorId, plan, estimatedMinutes });
    case "groq":
      return reserveGroqSttMinutes({ vendorId, plan, estimatedMinutes });
    case "nvidia":
      // Legacy path; v0 deliberately does not enforce a per-vendor minute
      // cap because traffic is gated to the rate limiter only. Add one if
      // we ever reverse the OpenAI/NVIDIA priority again.
      return { ok: true };
  }
}

async function releaseQuota(
  provider: SttSource,
  vendorId: string,
  estimatedMinutes: number,
): Promise<void> {
  switch (provider) {
    case "sarvam":
      return releaseSarvamMinutes({ vendorId, estimatedMinutes });
    case "openai":
      return releaseOpenaiSttMinutes({ vendorId, estimatedMinutes });
    case "groq":
      return releaseGroqSttMinutes({ vendorId, estimatedMinutes });
    case "nvidia":
      return;
  }
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let vendorId = "";
  let lang = "";
  let lastSource: SttSource | null = null;
  const attempts: AttemptResult[] = [];

  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    vendorId = ctx.vendor.id;

    const aiLimiter = getAiLimiterForPlan(ctx.vendor.plan);
    const burst = await aiLimiter.burst.check(ctx.vendor.id);
    if (!burst.ok) return tooManyRequests(burst, "ai-burst");
    const sustained = await aiLimiter.minute.check(ctx.vendor.id);
    if (!sustained.ok) return tooManyRequests(sustained, "ai");

    const form = await req.formData();
    const audio = form.get("audio");
    lang = typeof form.get("lang") === "string" ? (form.get("lang") as string) : "";

    // Plan gate after lang is parsed so the PlanGateError catch can report
    // the right feature for the vendor's language.
    requirePlan(ctx.vendor, Plan.STARTER);

    const cascade = buildCascade(lang);
    if (cascade.length === 0) {
      const fallbackLangs = openaiConfigured() || nvidiaConfigured() || groqConfigured()
        ? FALLBACK_LANGS
        : [];
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

    for (const provider of cascade) {
      lastSource = provider;
      const breaker = getBreaker(`stt:${provider}`);

      if (!(await breaker.allow())) {
        attempts.push({ ok: false, provider, reason: "breaker_open" });
        continue;
      }

      const usage = await reserveQuota(provider, ctx.vendor.id, ctx.vendor.plan, estimatedMinutes);
      if (!usage.ok) {
        attempts.push({
          ok: false,
          provider,
          reason: "quota",
          code: usage.code,
          message: usage.message,
        });
        continue;
      }

      const t0 = Date.now();
      try {
        const { transcript } = await callProvider(provider, audio, lang);
        const elapsed = Date.now() - t0;
        await breaker.recordSuccess();
        attempts.push({ ok: true, provider, transcript, durationMs: elapsed });

        const durationMs = Date.now() - started;
        console.log(
          JSON.stringify({
            route: "/api/ai/transcribe",
            vendorId,
            lang,
            sttSource: provider,
            providerDurationMs: elapsed,
            durationMs,
            attempts: attempts.map((a) =>
              a.ok ? { provider: a.provider, ok: true, ms: a.durationMs }
                   : { provider: a.provider, ok: false, reason: a.reason },
            ),
            success: true,
          }),
        );

        return NextResponse.json({ transcript, durationMs, sttSource: provider });
      } catch (providerErr) {
        await Promise.all([
          breaker.recordFailure(),
          releaseQuota(provider, ctx.vendor.id, estimatedMinutes),
        ]);
        attempts.push({
          ok: false,
          provider,
          reason: "error",
          message: providerErr instanceof Error ? providerErr.message : "unknown",
        });
      }
    }

    // Whole cascade exhausted. Last resort is the client's QuickAddGrid.
    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        route: "/api/ai/transcribe",
        vendorId,
        lang,
        sttSource: lastSource,
        durationMs,
        attempts: attempts.map((a) =>
          a.ok ? { provider: a.provider, ok: true, ms: a.durationMs }
               : { provider: a.provider, ok: false, reason: a.reason },
        ),
        success: false,
        cascadeExhausted: true,
      }),
    );
    return NextResponse.json(
      { error: "all_providers_failed", fallback: "quickadd" },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof PlanGateError) {
      const featureBySource: Record<SttSource, string> = {
        sarvam: "sarvam_stt",
        openai: "openai_stt",
        nvidia: "nvidia_stt",
        groq: "groq_stt",
      };
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: lastSource
            ? featureBySource[lastSource]
            : isFallbackLang(lang)
              ? "openai_stt"
              : "sarvam_stt",
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
        sttSource: lastSource,
        durationMs,
        success: false,
      }),
    );

    return NextResponse.json({ error: message, fallback: "quickadd" }, { status: 200 });
  }
}
