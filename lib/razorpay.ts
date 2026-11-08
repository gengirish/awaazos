import crypto from "node:crypto";

import type { Plan } from "@prisma/client";
import Razorpay from "razorpay";

import { requireEnv } from "@/lib/env";
import {
  BILLING_INTERVALS,
  SUBSCRIBABLE_PLANS,
  SUBSCRIPTION_TOTAL_COUNT,
  type BillingInterval,
  type SubscribablePlan,
  type SubscriptionSnapshot,
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

function planEnv(plan: SubscribablePlan, interval: BillingInterval): string | undefined {
  if (plan === "STARTER") return starterPlanEnv(interval);
  return process.env[`RAZORPAY_PLAN_${plan}_${interval.toUpperCase()}`];
}

export function getRazorpayPlanId(plan: SubscribablePlan, interval: BillingInterval): string {
  const id = planEnv(plan, interval);
  if (!id) {
    throw new Error(
      `Required environment variable RAZORPAY_PLAN_${plan}_${interval.toUpperCase()} is not configured`,
    );
  }
  return id;
}

/**
 * Plans we no longer sell but subscribers still renew on, because a Razorpay
 * plan's amount is fixed: `RAZORPAY_RETIRED_PLANS=plan_abc:STARTER:monthly,...`,
 * printed by `npm run razorpay:create-plans`. Without an entry, a subscription
 * from before its `notes` carried the plan would stop being credited.
 */
function retiredPlan(planId: string): { plan: Plan; interval: BillingInterval } | null {
  for (const entry of (process.env.RAZORPAY_RETIRED_PLANS ?? "").split(",")) {
    const [id, plan, interval] = entry.trim().split(":");
    if (
      id === planId &&
      (SUBSCRIBABLE_PLANS as readonly unknown[]).includes(plan) &&
      (BILLING_INTERVALS as readonly unknown[]).includes(interval)
    ) {
      return { plan: plan as SubscribablePlan, interval: interval as BillingInterval };
    }
  }
  return null;
}

/** Map a Razorpay `plan_id` to our plan + interval using the env ids (no throw if unset). */
export function planFromRazorpayPlanId(
  planId: string,
): { plan: Plan; interval: BillingInterval } | null {
  if (!planId) return null;
  const e = process.env;
  const retired = retiredPlan(planId);
  if (retired) return retired;
  if (planId === e.RAZORPAY_PLAN_STARTER_YEARLY) return { plan: "STARTER", interval: "yearly" };
  if (planId === e.RAZORPAY_PLAN_STARTER_MONTHLY || planId === e.RAZORPAY_PLAN_STARTER) {
    return { plan: "STARTER", interval: "monthly" };
  }
  for (const plan of ["LITE", "PRO"] as const) {
    for (const interval of BILLING_INTERVALS) {
      if (planId === planEnv(plan, interval)) return { plan, interval };
    }
  }
  // From before PRO was sold: a hand-made PRO subscription must still renew.
  if (planId === e.RAZORPAY_PLAN_PRO) return { plan: "PRO", interval: "monthly" };
  return null;
}

/**
 * Our plan from a subscription's `notes`, which only this server writes
 * (`createSubscription`). A custom-price plan id is in no env var, so without
 * this a store on one would be charged and get no plan.
 */
function planFromNotes(notes: unknown): { plan: Plan; interval: BillingInterval } | null {
  if (!notes || typeof notes !== "object") return null;
  const { plan, interval } = notes as Record<string, unknown>;
  if (!(SUBSCRIBABLE_PLANS as readonly unknown[]).includes(plan)) return null;
  if (!(BILLING_INTERVALS as readonly unknown[]).includes(interval)) return null;
  return { plan: plan as SubscribablePlan, interval: interval as BillingInterval };
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

/** What Razorpay will charge per cycle on this plan, in paise. */
export async function fetchRazorpayPlanAmountPaise(planId: string): Promise<number> {
  const plan = await withTimeout(getRazorpay().plans.fetch(planId), RAZORPAY_API_TIMEOUT_MS, "razorpay.plans.fetch");
  return Number(plan.item.amount);
}

/** A plan at a custom amount (lib/custom-subscription-plan.ts). Returns its Razorpay id. */
export async function createRazorpayPlan({
  plan,
  interval,
  basePaise,
  amountPaise,
}: {
  plan: SubscribablePlan;
  interval: BillingInterval;
  basePaise: number;
  amountPaise: number;
}): Promise<string> {
  const created = await withTimeout(
    getRazorpay().plans.create({
      period: interval,
      interval: 1,
      item: {
        name: `AwaazOS Starter ${interval} (store price)`,
        amount: amountPaise,
        currency: "INR",
        description: `${basePaise / 100} rupees + 18% GST`,
      },
      notes: { plan, interval },
    }),
    RAZORPAY_API_TIMEOUT_MS,
    "razorpay.plans.create",
  );
  return created.id;
}

export async function createSubscription({
  plan,
  interval,
  planId,
  vendorId,
  startAt,
  resumesPaidPeriod,
}: {
  plan: SubscribablePlan;
  interval: BillingInterval;
  /** From `resolveSubscriptionPlanId`. */
  planId: string;
  vendorId: string;
  /** First charge date. Set while the vendor is in the trial so they keep all 30 days. */
  startAt?: Date | null;
  /** Starts when a paid period ends: `applySubscriptionEvent` must leave that period alone. */
  resumesPaidPeriod?: boolean;
}): Promise<{ subscriptionId: string; shortUrl: string }> {
  const rz = getRazorpay();
  const sub = await withTimeout(
    rz.subscriptions.create({
      plan_id: planId,
      total_count: SUBSCRIPTION_TOTAL_COUNT[interval],
      customer_notify: 1,
      quantity: 1,
      ...(startAt ? { start_at: Math.floor(startAt.getTime() / 1000) } : {}),
      // `plan` and `interval` are what planFromNotes reads for a custom-price plan.
      notes: { vendorId, plan, interval, ...(resumesPaidPeriod ? { resumesPaidPeriod: "1" } : {}) },
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

/**
 * Razorpay Checkout success for a subscription:
 * HMAC-SHA256(`${paymentId}|${subscriptionId}`, key secret). Note the order —
 * it is the reverse of the Orders signature in lib/storefront-razorpay.ts.
 */
export function verifySubscriptionPaymentSignature(
  paymentId: string,
  subscriptionId: string,
  signature: string | null | undefined,
): boolean {
  if (!signature || !paymentId || !subscriptionId || !/^[0-9a-f]+$/i.test(signature)) return false;
  const secret = requireEnv("RAZORPAY_KEY_SECRET");
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(`${paymentId}|${subscriptionId}`, "utf8")
    .digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/** The platform account's public key id, for Checkout in the browser. */
export function getRazorpayKeyId(): string {
  return requireEnv("RAZORPAY_KEY_ID");
}

/** A subscription entity (webhook payload or a fetch) → the fields the state machine reads. */
export function toSubscriptionSnapshot(id: string, entity: Record<string, unknown>): SubscriptionSnapshot {
  const planId = typeof entity.plan_id === "string" ? entity.plan_id : "";
  return {
    id,
    status: typeof entity.status === "string" && entity.status ? entity.status : "unknown",
    mapped: planFromRazorpayPlanId(planId) ?? planFromNotes(entity.notes),
    currentEnd: fromUnixSeconds(entity.current_end),
    startAt: fromUnixSeconds(entity.start_at),
    resumesPaidPeriod: Boolean(entity.notes && (entity.notes as Record<string, unknown>).resumesPaidPeriod),
    paidCount: typeof entity.paid_count === "number" ? entity.paid_count : null,
  };
}

/** Unix seconds from a Razorpay entity → Date, or null. */
export function fromUnixSeconds(v: unknown): Date | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v * 1000) : null;
}
