import crypto from "node:crypto";

import type { Plan } from "@prisma/client";
import Razorpay from "razorpay";

import { requireEnv } from "@/lib/env";
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
 * Razorpay plan ids from the dashboard (test / live). Not in `env` schema — validated here.
 */
export function getRazorpayPlanIdForBillingPlan(plan: "STARTER" | "PRO"): string {
  const key = plan === "PRO" ? "RAZORPAY_PLAN_PRO" : "RAZORPAY_PLAN_STARTER";
  const id = process.env[key];
  if (!id) {
    throw new Error(`Required environment variable ${key} is not configured`);
  }
  return id;
}

/** Map a Razorpay `plan_id` to our `Plan` using dashboard env ids (no throw if unset). */
export function planFromRazorpayPlanId(planId: string): Plan | null {
  const starter = process.env.RAZORPAY_PLAN_STARTER;
  const pro = process.env.RAZORPAY_PLAN_PRO;
  if (pro && planId === pro) return "PRO";
  if (starter && planId === starter) return "STARTER";
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
  planCode,
  vendorId,
}: {
  planCode: "STARTER" | "PRO";
  vendorId: string;
}): Promise<{ subscriptionId: string; shortUrl: string }> {
  const rz = getRazorpay();
  const plan_id = getRazorpayPlanIdForBillingPlan(planCode);
  const sub = await withTimeout(
    rz.subscriptions.create({
      plan_id,
      total_count: 120,
      customer_notify: 1,
      quantity: 1,
      notes: { vendorId },
    }),
    RAZORPAY_API_TIMEOUT_MS,
    "razorpay.subscriptions.create",
  );
  const subscriptionId = sub.id;
  const shortUrl = sub.short_url;
  if (!shortUrl) {
    throw new Error("Razorpay subscription response missing short_url");
  }
  return { subscriptionId, shortUrl };
}
