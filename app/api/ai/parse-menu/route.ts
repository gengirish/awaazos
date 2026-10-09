import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reserveAnthropicTokens } from "@/lib/ai-usage-guard";
import { requireEnv } from "@/lib/env";
import { parseMenuFromTranscript } from "@/lib/parse-menu";
import { prisma } from "@/lib/prisma";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Haiku (15s, 1 retry) + Sonnet escalation (25s) for a long dictation. */
export const maxDuration = 60;

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  lang: z.string().trim().min(1).max(16).optional(),
});

/** Output tokens budgeted per call (max_tokens in lib/parse-menu.ts). */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * POST /api/ai/parse-menu — voice menu builder.
 *
 * Transcript (already STT'd) → DRAFT list of dishes for the vendor to review.
 * Nothing is saved; the review screen saves with POST /api/menu/bulk. Same
 * protections as /api/ai/parse-drop (per-plan AI rate limit, monthly Anthropic
 * token cap); CASHIER like POST /api/menu.
 *
 * No voice-parse-log telemetry (VoiceParseLog is order-shaped, see parse-drop).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    const aiLimiter = getAiLimiterForPlan(ctx.vendor.plan);
    const burst = await aiLimiter.burst.check(ctx.vendor.id);
    if (!burst.ok) return tooManyRequests(burst, "ai-burst");
    const sustained = await aiLimiter.minute.check(ctx.vendor.id);
    if (!sustained.ok) return tooManyRequests(sustained, "ai");

    const body = bodySchema.parse(await req.json());

    try {
      requireEnv("ANTHROPIC_API_KEY");
    } catch {
      return NextResponse.json({ error: "voice_unavailable", fallback: "form" }, { status: 503 });
    }

    // The whole menu (unavailable items too): "samosa 20" must find the hidden samosa, not duplicate it.
    const menuRows = await prisma.menuItem.findMany({
      where: { vendorId: ctx.vendor.id },
      select: {
        id: true,
        slug: true,
        name: true,
        aliases: true,
        tags: true,
        priceInPaise: true,
        category: true,
        emoji: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    const estimatedTokens =
      Math.ceil((JSON.stringify(menuRows).length + body.transcript.length) / 4) + MAX_OUTPUT_TOKENS;
    const usage = await reserveAnthropicTokens({
      vendorId: ctx.vendor.id,
      plan: ctx.vendor.plan,
      estimatedTokens,
    });
    if (!usage.ok) {
      return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
    }

    let draft;
    try {
      ({ draft } = await parseMenuFromTranscript({
        menuItems: menuRows,
        transcript: body.transcript,
        lang: body.lang ?? "en-IN",
      }));
    } catch (parseErr) {
      console.error(
        "[api/ai/parse-menu] Claude parse failed",
        parseErr instanceof Error ? parseErr.message : "unknown",
      );
      return NextResponse.json({ error: "Internal server error", fallback: "form" }, { status: 500 });
    }

    const res = NextResponse.json({ data: draft });
    if (ctx.setVendorCookie) {
      res.cookies.set("awz_vendor", ctx.setVendorCookie, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("[api/ai/parse-menu]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
