import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { cancelSubscription, fetchSubscription } from "@/lib/razorpay";
import { billingRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function maskId(id: string): string {
  return id.length <= 4 ? "****" : `…${id.slice(-4)}`;
}

/**
 * Cancel the platform subscription. An `active` one is cancelled at the end of
 * the billing cycle, so the vendor keeps what they paid for; access then runs
 * out lazily at `planExpiresAt` + grace (lib/plan.ts). Anything not currently
 * paid up (created, authenticated, pending, halted, paused) is cancelled now.
 * The webhook records the final state either way.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const rl = await billingRateLimit.check(ctx.vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "billing");

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { razorpaySubId: true },
    });
    const subId = settings?.razorpaySubId;
    if (!subId) {
      return NextResponse.json({ error: "No Razorpay subscription on file." }, { status: 400 });
    }

    const sub = await fetchSubscription(subId);
    let cancelAtEnd = false;
    if (sub.status === "active") {
      await cancelSubscription(subId, true);
      cancelAtEnd = true;
      await prisma.vendorSettings.update({
        where: { vendorId: ctx.vendor.id },
        data: { razorpaySubCancelAtEnd: true, razorpaySubStatus: sub.status },
      });
    } else {
      if (["created", "authenticated", "pending", "halted", "paused"].includes(sub.status)) {
        await cancelSubscription(subId, false);
      }
      // Already cancelled/completed/expired, or cancelled just now.
      await prisma.vendorSettings.update({
        where: { vendorId: ctx.vendor.id },
        data: { razorpaySubId: null, razorpaySubStatus: "cancelled", razorpaySubCancelAtEnd: false },
      });
    }

    console.info(
      "[api/razorpay/cancel-subscription] sub %s was %s, cancelAtEnd=%s",
      maskId(subId),
      sub.status,
      cancelAtEnd,
    );

    const res = NextResponse.json({ success: true, cancelAtEnd });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(
      "[api/razorpay/cancel-subscription]",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
