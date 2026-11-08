import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SUBSCRIBE_REFUSAL_MESSAGE, subscribeDecision } from "@/lib/billing-actions";
import { resolveSubscriptionPlanId } from "@/lib/custom-subscription-plan";
import { prisma } from "@/lib/prisma";
import {
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  getRazorpayKeyId,
} from "@/lib/razorpay";
import { billingRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { redeemBankedRewardsAtSubscribe } from "@/lib/referral-server";
import { BILLING_INTERVALS, SUBSCRIBABLE_PLANS } from "@/lib/subscription";

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

/** Not live, but Razorpay can still charge these again: they must end before a new one starts. */
const CAN_CHARGE_AGAIN = ["halted", "paused"];

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const rl = await billingRateLimit.check(ctx.vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "billing");

    // A demo store (lib/demo-store.ts) is never billed; its owner subscribes after claiming it.
    if (ctx.vendor.isDemo) {
      return NextResponse.json({ error: "demo_store_not_billable" }, { status: 409 });
    }

    const body = bodySchema.parse(await req.json());

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { razorpaySubId: true, razorpaySubStatus: true, razorpaySubCancelAtEnd: true },
    });

    // The subscription on file, as Razorpay has it: our stored status can trail
    // a lost webhook. Fetched before any banked referral months are redeemed, so
    // a live sub found here never has free time applied under it.
    const previousId = settings?.razorpaySubId ?? null;
    let previous: Awaited<ReturnType<typeof fetchSubscription>> | null = null;
    if (previousId) {
      try {
        previous = await fetchSubscription(previousId);
      } catch (err) {
        // Unknown to Razorpay (e.g. test-mode id under live keys) or a timeout:
        // the stored status decides.
        console.warn(
          "[api/razorpay/create-subscription] previous sub %s: %s",
          maskId(previousId),
          err instanceof Error ? err.message : "unknown",
        );
      }
    }

    // The one rule (lib/billing-actions.ts). This is what stops a second
    // subscription while one is still charging.
    const now = new Date();
    const previousStatus = previous?.status ?? settings?.razorpaySubStatus ?? null;
    const decision = subscribeDecision(
      {
        access: ctx.access,
        planExpiresAt: ctx.vendor.planExpiresAt ?? null,
        razorpaySubId: previousId,
        razorpaySubStatus: previousStatus,
        razorpaySubCancelAtEnd: settings?.razorpaySubCancelAtEnd ?? false,
        customPricePaise: ctx.vendor.customPricePaise,
      },
      body.plan,
      now,
    );
    if (!decision.ok) {
      return NextResponse.json({ error: SUBSCRIBE_REFUSAL_MESSAGE[decision.reason] }, { status: 400 });
    }

    // Public key id for in-app Checkout; `shortUrl` stays as the fallback
    // when checkout.js can't load. Throws (→ 500) before anything is created
    // if billing isn't configured on this deploy.
    const keyId = getRazorpayKeyId();

    // Razorpay can't move a UPI AutoPay subscription to another plan, so the
    // old one ends and a new one starts. Same for one that could resume charging.
    const endsPrevious = decision.action === "upgrade" || CAN_CHARGE_AGAIN.includes(previousStatus ?? "");
    // Couldn't read the one being replaced: stop, or it could keep charging too.
    if (endsPrevious && !previous) {
      return NextResponse.json({ error: "Couldn't reach Razorpay. Please try again." }, { status: 503 });
    }

    // This store's plan: the list plan, or the one for its custom price. Before
    // referral months are redeemed, so a Razorpay failure here costs them nothing.
    const planId = await resolveSubscriptionPlanId({
      plan: body.plan,
      interval: body.interval,
      customPricePaise: ctx.vendor.customPricePaise,
    });

    // Not in the forgiving try below: if this fails, nothing new may be created,
    // or the seller is charged twice. The id on file changes below, so this
    // cancellation's webhook won't clear it.
    if (endsPrevious && previousId) {
      await cancelSubscription(previousId, false);
    }

    // Banked referral months (lib/referral.ts) move trialEndsAt forward first,
    // so the first charge below is deferred past them. Nothing banked → null.
    const redeemedTrialEnd = await redeemBankedRewardsAtSubscribe(ctx.vendor.id, now);
    // Subscribing during the trial defers the first charge to the trial's end.
    const trialEndsAt = redeemedTrialEnd ?? ctx.vendor.trialEndsAt;
    let startAt = trialEndsAt && trialEndsAt.getTime() > now.getTime() ? trialEndsAt : null;
    // Resubscribing inside a paid period waits for that period's end, so nobody
    // pays twice for the same days.
    const resumesPaidPeriod = decision.start === "period_end";
    const paidUntil = ctx.vendor.planExpiresAt ?? null;
    if (resumesPaidPeriod && paidUntil && (!startAt || paidUntil.getTime() > startAt.getTime())) {
      startAt = paidUntil;
    }
    const startAtSec = startAt ? Math.floor(startAt.getTime() / 1000) : null;

    // An earlier checkout nobody paid: reuse it if it's for the same plan,
    // otherwise cancel it so its emailed link can't be paid later.
    if (previousId && previous) {
      try {
        if (previous.status === "created") {
          // Same plan id, not just same plan name: a checkout left over from
          // before the store's price changed must not be payable at the old price.
          const sameStart = (previous.start_at ?? null) === startAtSec;
          if (previous.plan_id === planId && sameStart && previous.short_url) {
            const res = NextResponse.json({
              subscriptionId: previous.id,
              shortUrl: previous.short_url,
              keyId,
            });
            return withVendorCookie(res, ctx.setVendorCookie);
          }
          await cancelSubscription(previousId, false);
        }
      } catch (err) {
        // A leftover checkout we couldn't cancel or reuse: carry on and make a fresh one.
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
      planId,
      vendorId: ctx.vendor.id,
      startAt,
      resumesPaidPeriod,
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

    const res = NextResponse.json({ subscriptionId, shortUrl, keyId });
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
