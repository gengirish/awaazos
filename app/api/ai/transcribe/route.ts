import { NextRequest, NextResponse } from "next/server";

import { Plan } from "@prisma/client";

import { reserveSarvamMinutes } from "@/lib/ai-usage-guard";
import { transcribeAudio as transcribeViaSarvam, type SarvamLang } from "@/lib/sarvam";
import { transcribeAudio as transcribeViaNvidia, type NvidiaLang } from "@/lib/nvidia";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SARVAM_LANGS = ["te-IN", "kn-IN", "ta-IN"] as const satisfies readonly SarvamLang[];
const NVIDIA_LANGS = ["en-IN", "hi-IN"] as const satisfies readonly NvidiaLang[];

function isSarvamLang(s: string): s is SarvamLang {
  return (SARVAM_LANGS as readonly string[]).includes(s);
}

function isNvidiaLang(s: string): s is NvidiaLang {
  return (NVIDIA_LANGS as readonly string[]).includes(s);
}

function nvidiaConfigured(): boolean {
  const key = process.env.NVIDIA_API_KEY;
  return typeof key === "string" && key.startsWith("nvapi-");
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let vendorId = "";
  let lang = "";
  let sttSource: "sarvam" | "nvidia" | null = null;

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

    const sarvam = isSarvamLang(lang);
    const nvidia = !sarvam && isNvidiaLang(lang) && nvidiaConfigured();

    if (!sarvam && !nvidia) {
      return NextResponse.json(
        {
          error: "use_webspeech",
          supportedLangs: [
            ...SARVAM_LANGS,
            ...(nvidiaConfigured() ? NVIDIA_LANGS : []),
          ],
        },
        { status: 400 },
      );
    }

    sttSource = sarvam ? "sarvam" : "nvidia";

    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "Missing audio" }, { status: 400 });
    }

    let transcript: string;

    if (sarvam) {
      // Rough estimate: mobile WebM voice captures are often ~32kbps -> ~240KB/min.
      const estimatedMinutes = Math.max(1 / 60, audio.size / 240_000);
      const usage = await reserveSarvamMinutes({
        vendorId: ctx.vendor.id,
        plan: ctx.vendor.plan,
        estimatedMinutes,
      });
      if (!usage.ok) {
        return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
      }
      ({ transcript } = await transcribeViaSarvam(audio, lang as SarvamLang));
    } else {
      // NVIDIA path: hosted Parakeet via NVCF. v0 uses the rate-limiter only as
      // a quota guard. TODO: add a generic STT-minutes counter once we know
      // real-world usage shapes.
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
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: sttSource === "nvidia" ? "nvidia_stt" : "sarvam_stt",
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

    return NextResponse.json(
      { error: message, fallback: "quickadd" },
      { status: 200 },
    );
  }
}
