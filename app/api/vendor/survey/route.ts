import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { ownerSurveySchema } from "@/lib/owner-survey";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/vendor/survey: save this store's owner survey (lib/owner-survey.ts).
 * OWNER only, one row per store, answering again replaces it. A demo store gets
 * 404: its owner is our own demo account, so its answers would mean nothing.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    if (ctx.vendor.isDemo) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const answers = ownerSurveySchema.parse(await req.json());
    await prisma.ownerSurveyResponse.upsert({
      where: { vendorId: ctx.vendor.id },
      create: { vendorId: ctx.vendor.id, ...answers },
      update: answers,
    });

    const res = NextResponse.json({ data: { saved: true } });
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
    // Never the body: the comment is the owner's free text.
    logger.error(
      { route: "PUT /api/vendor/survey", error: err instanceof Error ? err.name : "unknown" },
      "owner survey save failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
