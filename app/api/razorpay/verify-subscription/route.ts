import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { billingAccess } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import {
  fetchSubscription,
  toSubscriptionSnapshot,
  verifySubscriptionPaymentSignature,
} from "@/lib/razorpay";
import { billingRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import type { SubscriptionEventName } from "@/lib/subscription";
import { recordSubscriptionEvent } from "@/lib/subscription-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Razorpay Checkout success handler for a platform subscription
 * (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md, Phase 4). Lets the plan unlock the
 * moment the vendor pays instead of waiting for the webhook.
 *
 * The browser's word is never trusted: the signature proves Razorpay issued
 * this payment for this subscription, the subscription must be the one on
 * file for the signed-in vendor, and its state is then read from Razorpay
 * itself. The write goes through the same `recordSubscriptionEvent` as the
 * webhook, so whichever arrives second changes nothing.
 */

const bodySchema = z.object({
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_subscription_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
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

/** The event a freshly paid subscription's status stands for, if any. */
function eventForStatus(status: string): SubscriptionEventName | null {
  if (status === "active") return "subscription.activated";
  if (status === "authenticated") return "subscription.authenticated";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const rl = await billingRateLimit.check(ctx.vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "billing");

    const body = bodySchema.parse(await req.json());
    const subId = body.razorpay_subscription_id;

    // Only the subscription this vendor started. Anything else is "not found",
    // whether or not it exists for someone else.
    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { razorpaySubId: true },
    });
    if (!settings?.razorpaySubId || settings.razorpaySubId !== subId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!verifySubscriptionPaymentSignature(body.razorpay_payment_id, subId, body.razorpay_signature)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }

    let entity: Record<string, unknown>;
    try {
      entity = (await fetchSubscription(subId)) as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn(
        "[api/razorpay/verify-subscription] fetch sub %s: %s",
        maskId(subId),
        err instanceof Error ? err.message : "unknown",
      );
      // The payment is real; the webhook will still apply it.
      return NextResponse.json({ error: "razorpay_unavailable" }, { status: 502 });
    }

    const notes = entity.notes && typeof entity.notes === "object" ? (entity.notes as Record<string, unknown>) : {};
    if (notes.vendorId !== ctx.vendor.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sub = toSubscriptionSnapshot(subId, entity);
    const event = eventForStatus(sub.status);
    if (event) {
      // Keyed on payment + status: a retry after `authenticated` became
      // `active` is a new fact, the same call twice is not.
      await recordSubscriptionEvent({
        eventId: `verify:${body.razorpay_payment_id}:${sub.status}`,
        event,
        sub,
        vendorId: ctx.vendor.id,
        paymentId: body.razorpay_payment_id,
      });
    }

    const vendor = await prisma.vendor.findUniqueOrThrow({
      where: { id: ctx.vendor.id },
      select: { plan: true, planExpiresAt: true, trialEndsAt: true },
    });
    const active = billingAccess(vendor).kind === "paid";

    const res = NextResponse.json({ data: { status: sub.status, active } });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    console.error(
      "[api/razorpay/verify-subscription]",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
