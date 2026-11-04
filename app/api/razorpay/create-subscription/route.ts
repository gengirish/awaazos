import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PLAN_RANK } from "@/lib/constants";
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

    // A demo store (lib/demo-store.ts) is never billed; its owner subscribes after claiming it.
    if (ctx.vendor.isDemo) {
      return NextResponse.json({ error: "demo_store_not_billable" }, { status: 409 });
    }

    const body = bodySchema.parse(await req.json());

    // A store's own price is a price for Starter (lib/subscription.ts).
    if (ctx.vendor.customPricePaise !== null && body.plan !== "STARTER") {
      return NextResponse.json({ error: "Your store has its own price on the Starter plan." }, { status: 400 });
    }

    // Only a plan that is paid for blocks this — a vendor on the free trial
    // reads as STARTER but must still be able to subscribe.
    if (ctx.access.kind === "paid" && PLAN_RANK[ctx.access.plan] >= PLAN_RANK[body.plan]) {
      return NextResponse.json(
        { error: "You are already on this plan or higher." },
        { status: 400 },
      );
    }

    // Public key id for in-app Checkout; `shortUrl` stays as the fallback
    // when checkout.js can't load. Throws (→ 500) before anything is created
    // if billing isn't configured on this deploy.
    const keyId = getRazorpayKeyId();

    // Paying for a lower plan and moving up. Razorpay can't move a UPI AutoPay
    // subscription to another plan, so the old one ends and a new one starts.
    const isUpgrade = ctx.access.kind === "paid";

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { razorpaySubId: true, razorpaySubStatus: true },
    });
    const liveOnFile = LIVE_SUBSCRIPTION_STATUSES.includes(settings?.razorpaySubStatus ?? "");
    if (liveOnFile && !isUpgrade) {
      return NextResponse.json({ error: ALREADY_SUBSCRIBED }, { status: 400 });
    }

    // An earlier checkout nobody paid: reuse it if it's for the same plan,
    // otherwise cancel it so its emailed link can't be paid later. Fetched
    // before any banked referral months are redeemed, so a live sub found
    // here never has free time applied under it.
    const previousId = settings?.razorpaySubId;
    let previous: Awaited<ReturnType<typeof fetchSubscription>> | null = null;
    if (previousId) {
      try {
        previous = await fetchSubscription(previousId);
      } catch (err) {
        // Unknown to Razorpay (e.g. test-mode id under live keys) or a timeout:
        // carry on and make a fresh one.
        console.warn(
          "[api/razorpay/create-subscription] previous sub %s: %s",
          maskId(previousId),
          err instanceof Error ? err.message : "unknown",
        );
      }
      if (previous && LIVE_SUBSCRIPTION_STATUSES.includes(previous.status) && !isUpgrade) {
        return NextResponse.json({ error: ALREADY_SUBSCRIBED }, { status: 400 });
      }
    }
    const replacesLive =
      isUpgrade && (liveOnFile || (previous !== null && LIVE_SUBSCRIPTION_STATUSES.includes(previous.status)));
    // Couldn't read the one being replaced: stop, or it could keep charging too.
    if (replacesLive && !previous) {
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
    if (replacesLive && previousId) {
      await cancelSubscription(previousId, false);
    }

    const now = new Date();
    // Banked referral months (lib/referral.ts) move trialEndsAt forward first,
    // so the first charge below is deferred past them. Nothing banked → null.
    const redeemedTrialEnd = await redeemBankedRewardsAtSubscribe(ctx.vendor.id, now);
    // Subscribing during the trial defers the first charge to the trial's end.
    const trialEndsAt = redeemedTrialEnd ?? ctx.vendor.trialEndsAt;
    const startAt = trialEndsAt && trialEndsAt.getTime() > now.getTime() ? trialEndsAt : null;
    const startAtSec = startAt ? Math.floor(startAt.getTime() / 1000) : null;

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
      planId,
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
