import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { ownerSurveySchema } from "@/lib/owner-survey";
import { prisma } from "@/lib/prisma";
import { getClientIp, publicSurveyRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/survey: one answer from the public /survey link (lib/owner-survey.ts).
 * No session and no store: the row holds the answers and nothing else, and the
 * IP is used for the rate limit only, never stored.
 */
export async function POST(req: NextRequest) {
  const rl = await publicSurveyRateLimit.check(getClientIp(req));
  if (!rl.ok) return tooManyRequests(rl, "public-survey");

  try {
    const answers = ownerSurveySchema.parse(await req.json());
    await prisma.publicSurveyResponse.create({ data: answers, select: { id: true } });
    return NextResponse.json({ data: { saved: true } }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    // Never the body: the comment is free text.
    logger.error(
      { route: "POST /api/survey", error: err instanceof Error ? err.name : "unknown" },
      "public survey save failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
