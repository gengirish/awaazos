import { NextRequest, NextResponse } from "next/server";

import { Plan } from "@prisma/client";

import { transcribeAudio, type SarvamLang } from "@/lib/sarvam";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SARVAM_LANGS = ["te-IN", "kn-IN", "ta-IN"] as const satisfies readonly SarvamLang[];

function isSarvamLang(s: string): s is SarvamLang {
  return (SARVAM_LANGS as readonly string[]).includes(s);
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let vendorId = "";
  let lang = "";

  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    vendorId = ctx.vendor.id;
    requirePlan(ctx.vendor, Plan.STARTER);

    const form = await req.formData();
    const audio = form.get("audio");
    lang = typeof form.get("lang") === "string" ? (form.get("lang") as string) : "";

    if (!isSarvamLang(lang)) {
      return NextResponse.json(
        { error: "use_webspeech", supportedLangs: [...SARVAM_LANGS] },
        { status: 400 },
      );
    }

    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "Missing audio" }, { status: 400 });
    }

    const { transcript } = await transcribeAudio(audio, lang);
    const durationMs = Date.now() - started;

    console.log(
      JSON.stringify({
        route: "/api/ai/transcribe",
        vendorId,
        lang,
        durationMs,
        success: true,
      }),
    );

    return NextResponse.json({ transcript, durationMs });
  } catch (err) {
    if (err instanceof PlanGateError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: "sarvam_stt",
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
