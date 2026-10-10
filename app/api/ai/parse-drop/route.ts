import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reserveAnthropicTokens } from "@/lib/ai-usage-guard";
import { requireEnv } from "@/lib/env";
import { parseDropFromTranscript } from "@/lib/parse-drop";
import { prisma } from "@/lib/prisma";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireActiveBilling, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(1000),
  lang: z.string().trim().min(1).max(16).optional(),
});

/**
 * POST /api/ai/parse-drop — voice drop builder.
 *
 * Transcript (already STT'd) → DRAFT drop for the vendor to review in the drop
 * form. Nothing is saved. Same protections as /api/ai/parse-order (per-plan AI
 * rate limit, monthly Anthropic token cap); MANAGER like the drop builder.
 *
 * No voice-parse-log telemetry: VoiceParseLog has no "kind" column and requires
 * an STT source + order confidence, so a drop row would pollute the order-parse
 * stats. Revisit if the log grows a kind.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    requireActiveBilling(ctx);

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

    // Available items only; showOnline=false (counter-only) items may still go in a drop.
    const menuRows = await prisma.menuItem.findMany({
      where: { vendorId: ctx.vendor.id, isAvailable: true },
      select: { id: true, slug: true, name: true, aliases: true, tags: true, priceInPaise: true },
      orderBy: { sortOrder: "asc" },
    });

    const estimatedTokens = Math.ceil((JSON.stringify(menuRows).length + body.transcript.length) / 4) + 1024;
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
      ({ draft } = await parseDropFromTranscript({
        menuItems: menuRows,
        transcript: body.transcript,
        lang: body.lang ?? "en-IN",
      }));
    } catch (parseErr) {
      console.error(
        "[api/ai/parse-drop] Claude parse failed",
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
    console.error("[api/ai/parse-drop]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
