import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PLAN_RANK } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import {
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  planFromRazorpayPlanId,
} from "@/lib/razorpay";
import { billingRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import {
  BILLING_INTERVALS,
  LIVE_SUBSCRIPTION_STATUSES,
  SUBSCRIBABLE_PLANS,
} from "@/lib/subscription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(SUBSCRIBABLE_PLANS),
  interval: z.enum(BILLING_INTERVALS).default("monthly"),
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

function maskId(id: string): string {
  return id.length <= 4 ? "****" : `…${id.slice(-4)}`;
}

const ALREADY_SUBSCRIBED = "You already have an active subscription.";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const rl = await billingRateLimit.check(ctx.vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "billing");

    const body = bodySchema.parse(await req.json());

    // Only a plan that is paid for blocks this — a vendor on the free trial
    // reads as STARTER but must still be able to subscribe.
    if (ctx.access.kind === "paid" && PLAN_RANK[ctx.access.plan] >= PLAN_RANK[body.plan]) {
      return NextResponse.json(
        { error: "You are already on this plan or higher." },
        { status: 400 },
      );
    }

    const now = new Date();
    // Subscribing during the trial defers the first charge to the trial's end.
    const trialEndsAt = ctx.vendor.trialEndsAt;
    const startAt = trialEndsAt && trialEndsAt.getTime() > now.getTime() ? trialEndsAt : null;
    const startAtSec = startAt ? Math.floor(startAt.getTime() / 1000) : null;

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { razorpaySubId: true, razorpaySubStatus: true },
    });
    if (settings?.razorpaySubStatus && LIVE_SUBSCRIPTION_STATUSES.includes(settings.razorpaySubStatus)) {
      return NextResponse.json({ error: ALREADY_SUBSCRIBED }, { status: 400 });
    }

    // An earlier checkout nobody paid: reuse it if it's for the same plan,
    // otherwise cancel it so its emailed link can't be paid later.
    const previousId = settings?.razorpaySubId;
    if (previousId) {
      try {
        const previous = await fetchSubscription(previousId);
        if (LIVE_SUBSCRIPTION_STATUSES.includes(previous.status)) {
          return NextResponse.json({ error: ALREADY_SUBSCRIBED }, { status: 400 });
        }
        if (previous.status === "created") {
          const mapped = planFromRazorpayPlanId(previous.plan_id);
          const sameStart = (previous.start_at ?? null) === startAtSec;
          if (
            mapped?.plan === body.plan &&
            mapped.interval === body.interval &&
            sameStart &&
            previous.short_url
          ) {
            const res = NextResponse.json({ subscriptionId: previous.id, shortUrl: previous.short_url });
            return withVendorCookie(res, ctx.setVendorCookie);
          }
          await cancelSubscription(previousId, false);
        }
      } catch (err) {
        // Unknown to Razorpay (e.g. test-mode id under live keys) or a timeout:
        // carry on and make a fresh one.
        console.warn(
          "[api/razorpay/create-subscription] previous sub %s: %s",
          maskId(previousId),
          err instanceof Error ? err.message : "unknown",
        );
      }
    }

    const { subscriptionId, shortUrl } = await createSubscription({
      plan: body.plan,
      interval: body.interval,
      vendorId: ctx.vendor.id,
      startAt,
    });

    const subFields = {
      razorpaySubId: subscriptionId,
      razorpaySubStatus: "created",
      razorpaySubCancelAtEnd: false,
    };
    await prisma.vendorSettings.upsert({
      where: { vendorId: ctx.vendor.id },
      create: { vendorId: ctx.vendor.id, ...subFields },
      update: subFields,
    });

    const res = NextResponse.json({ subscriptionId, shortUrl });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    console.error(
      "[api/razorpay/create-subscription]",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
