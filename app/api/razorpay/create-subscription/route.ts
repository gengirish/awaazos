import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PLAN_RANK } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { createSubscription } from "@/lib/razorpay";
import { AuthError, PlanGateError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(["STARTER", "PRO"]),
});

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const body = bodySchema.parse(await req.json());

    if (PLAN_RANK[ctx.vendor.plan] >= PLAN_RANK[body.plan]) {
      return NextResponse.json(
        { error: "You are already on this plan or higher." },
        { status: 400 },
      );
    }

    const { subscriptionId, shortUrl } = await createSubscription({
      planCode: body.plan,
      vendorId: ctx.vendor.id,
    });

    await prisma.vendorSettings.upsert({
      where: { vendorId: ctx.vendor.id },
      create: {
        vendorId: ctx.vendor.id,
        razorpaySubId: subscriptionId,
      },
      update: { razorpaySubId: subscriptionId },
    });

    const res = NextResponse.json({ subscriptionId, shortUrl });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof PlanGateError) {
      return NextResponse.json(
        { error: err.message, requiredPlan: err.required, currentPlan: err.current },
        { status: 402 },
      );
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    console.error("[api/razorpay/create-subscription]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
