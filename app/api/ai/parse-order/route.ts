import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
  parseOrderWithClaude,
} from "@/lib/anthropic";
import { reserveAnthropicTokens } from "@/lib/ai-usage-guard";
import { getVoiceLogQueue } from "@/lib/queues";
import { prisma } from "@/lib/prisma";
import { getAiLimiterForPlan, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  transcript: z.string().min(1),
  lang: z.string().min(1),
  sttSource: z.enum(["webspeech", "sarvam"]),
});

function wordCount(transcript: string): number {
  return transcript.trim().split(/\s+/).filter(Boolean).length;
}

function shouldEscalate(
  result: Awaited<ReturnType<typeof parseOrderWithClaude>>,
  transcript: string,
): boolean {
  const words = wordCount(transcript);
  if (result.items.length === 0 && words > 3) return true;
  if (result.confidence === "low" && result.unmatched.length > 0) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    const aiLimiter = getAiLimiterForPlan(ctx.vendor.plan);
    const burst = await aiLimiter.burst.check(ctx.vendor.id);
    if (!burst.ok) return tooManyRequests(burst, "ai-burst");
    const sustained = await aiLimiter.minute.check(ctx.vendor.id);
    if (!sustained.ok) return tooManyRequests(sustained, "ai");

    const body = bodySchema.parse(await req.json());

    const menuRows = await prisma.menuItem.findMany({
      where: { vendorId: ctx.vendor.id, isAvailable: true },
      select: { id: true, name: true, aliases: true, priceInPaise: true },
      orderBy: { sortOrder: "asc" },
    });

    const estimatedTokens = Math.ceil((JSON.stringify(menuRows).length + body.transcript.length) / 4) + 256;
    const usage = await reserveAnthropicTokens({
      vendorId: ctx.vendor.id,
      plan: ctx.vendor.plan,
      estimatedTokens,
    });
    if (!usage.ok) {
      return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
    }

    let modelUsed = ANTHROPIC_PRIMARY_MODEL;
    let escalated = false;
    let parsed: Awaited<ReturnType<typeof parseOrderWithClaude>>;

    const runHaiku = async () =>
      parseOrderWithClaude(
        anthropicHaiku,
        ANTHROPIC_PRIMARY_MODEL,
        menuRows,
        body.transcript,
        body.lang,
      );

    const runSonnet = async () =>
      parseOrderWithClaude(
        anthropicSonnet,
        ANTHROPIC_FALLBACK_MODEL,
        menuRows,
        body.transcript,
        body.lang,
      );

    try {
      try {
        parsed = await runHaiku();
        if (shouldEscalate(parsed, body.transcript)) {
          escalated = true;
          modelUsed = ANTHROPIC_FALLBACK_MODEL;
          parsed = await runSonnet();
        }
      } catch {
        escalated = true;
        modelUsed = ANTHROPIC_FALLBACK_MODEL;
        parsed = await runSonnet();
      }
    } catch (parseErr) {
      console.error("[api/ai/parse-order] Claude parse failed", parseErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const latencyMs = Date.now() - t0;

    try {
      void getVoiceLogQueue().add(
        "voice-parse-log",
        {
          vendorId: ctx.vendor.id,
          transcript: body.transcript,
          lang: body.lang,
          sttSource: body.sttSource,
          modelUsed,
          latencyMs,
          itemCount: parsed.items.length,
          confidence: parsed.confidence,
          unmatched: parsed.unmatched,
          escalated,
        },
        { attempts: 1, removeOnComplete: true },
      );
    } catch (queueErr) {
      console.error(
        "[api/ai/parse-order] voice-parse-log enqueue failed",
        queueErr instanceof Error ? queueErr.message : "unknown",
      );
    }

    const res = NextResponse.json({
      items: parsed.items,
      unmatched: parsed.unmatched,
      confidence: parsed.confidence,
      modelUsed,
    });
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
    console.error("[api/ai/parse-order]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
