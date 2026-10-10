import crypto from "node:crypto";

import type { Plan } from "@prisma/client";
import Razorpay from "razorpay";

import { requireEnv } from "@/lib/env";
import {
  SUBSCRIPTION_TOTAL_COUNT,
  type BillingInterval,
  type SubscribablePlan,
} from "@/lib/subscription";
import { withTimeout } from "@/lib/with-timeout";

const RAZORPAY_API_TIMEOUT_MS = 8_000;

let razorpaySingleton: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (!razorpaySingleton) {
    razorpaySingleton = new Razorpay({
      key_id: requireEnv("RAZORPAY_KEY_ID"),
      key_secret: requireEnv("RAZORPAY_KEY_SECRET"),
    });
  }
  return razorpaySingleton;
}

/**
 * Razorpay plan ids (test or live, matching the keys) — created by
 * `npm run razorpay:create-plans`. Not in the `env` schema; validated here.
 * `RAZORPAY_PLAN_STARTER` is the pre-yearly name for the monthly plan and is
 * still read so a deploy without the new vars keeps working.
 */
function starterPlanEnv(interval: BillingInterval): string | undefined {
  return interval === "yearly"
    ? process.env.RAZORPAY_PLAN_STARTER_YEARLY
    : (process.env.RAZORPAY_PLAN_STARTER_MONTHLY || process.env.RAZORPAY_PLAN_STARTER);
}

export function getRazorpayPlanId(plan: SubscribablePlan, interval: BillingInterval): string {
  const id = plan === "STARTER" ? starterPlanEnv(interval) : undefined;
  if (!id) {
    throw new Error(
      `Required environment variable RAZORPAY_PLAN_${plan}_${interval.toUpperCase()} is not configured`,
    );
  }
  return id;
}

/** Map a Razorpay `plan_id` to our plan + interval using the env ids (no throw if unset). */
export function planFromRazorpayPlanId(
  planId: string,
): { plan: Plan; interval: BillingInterval } | null {
  if (!planId) return null;
  const e = process.env;
  if (planId === e.RAZORPAY_PLAN_STARTER_YEARLY) return { plan: "STARTER", interval: "yearly" };
  if (planId === e.RAZORPAY_PLAN_STARTER_MONTHLY || planId === e.RAZORPAY_PLAN_STARTER) {
    return { plan: "STARTER", interval: "monthly" };
  }
  // PRO is no longer sold, but a hand-made PRO subscription must still renew.
  if (planId === e.RAZORPAY_PLAN_PRO) return { plan: "PRO", interval: "monthly" };
  return null;
}

export function verifyRazorpaySignature(rawBody: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const secret = requireEnv("RAZORPAY_WEBHOOK_SECRET");
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expectedHex, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export async function createSubscription({
  plan,
  interval,
  vendorId,
  startAt,
}: {
  plan: SubscribablePlan;
  interval: BillingInterval;
  vendorId: string;
  /** First charge date. Set while the vendor is in the trial so they keep all 30 days. */
  startAt?: Date | null;
}): Promise<{ subscriptionId: string; shortUrl: string }> {
  const rz = getRazorpay();
  const sub = await withTimeout(
    rz.subscriptions.create({
      plan_id: getRazorpayPlanId(plan, interval),
      total_count: SUBSCRIPTION_TOTAL_COUNT[interval],
      customer_notify: 1,
      quantity: 1,
      ...(startAt ? { start_at: Math.floor(startAt.getTime() / 1000) } : {}),
      notes: { vendorId },
    }),
    RAZORPAY_API_TIMEOUT_MS,
    "razorpay.subscriptions.create",
  );
  const shortUrl = sub.short_url;
  if (!shortUrl) {
    throw new Error("Razorpay subscription response missing short_url");
  }
  return { subscriptionId: sub.id, shortUrl };
}

export async function fetchSubscription(subscriptionId: string) {
  return withTimeout(
    getRazorpay().subscriptions.fetch(subscriptionId),
    RAZORPAY_API_TIMEOUT_MS,
    "razorpay.subscriptions.fetch",
  );
}

/** `atCycleEnd` keeps the paid period; false cancels now (only for a sub nothing was charged on). */
export async function cancelSubscription(subscriptionId: string, atCycleEnd: boolean) {
  return withTimeout(
    getRazorpay().subscriptions.cancel(subscriptionId, atCycleEnd),
    RAZORPAY_API_TIMEOUT_MS,
    "razorpay.subscriptions.cancel",
  );
}

/** Unix seconds from a Razorpay entity → Date, or null. */
export function fromUnixSeconds(v: unknown): Date | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v * 1000) : null;
}
