/**
 * Platform SaaS subscription state machine (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md).
 *
 * Pure — no Prisma, no Razorpay client — so every transition is unit-tested.
 * The webhook (`app/api/webhooks/razorpay/route.ts`) loads the vendor's
 * current billing state, calls `applySubscriptionEvent`, and writes the patch.
 *
 * Rules:
 * - `planExpiresAt` comes from Razorpay's own billing period (`current_end`),
 *   never from date maths, and only ever moves forward. Applying the same
 *   event twice, or `charged` before `activated`, lands in the same state.
 * - The webhook never downgrades a paying vendor. Expiry is lazy
 *   (`effectivePlan` in lib/plan.ts); cancelled/halted just stop extending
 *   `planExpiresAt`. The one exception: a subscription cancelled before its
 *   first charge (`paid_count` 0) takes back the access its `authenticated`
 *   event granted, since nothing was ever paid.
 * - Events for a subscription other than the one on file only touch the
 *   vendor's plan when they carry a payment (`activated` / `charged`); they
 *   never overwrite the status or clear the id of the current one.
 */
import type { Plan } from "@prisma/client";

import { GST_BPS, PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Paid plans a vendor can buy through Razorpay. PRO is not sold (TODO.md §2). */
export const SUBSCRIBABLE_PLANS = ["STARTER"] as const satisfies readonly Plan[];
export type SubscribablePlan = (typeof SUBSCRIBABLE_PLANS)[number];

/** Billing cycles before a Razorpay subscription completes: ten years either way. */
export const SUBSCRIPTION_TOTAL_COUNT: Record<BillingInterval, number> = {
  monthly: 120,
  yearly: 10,
};

export function gstPaise(basePaise: number): number {
  return Math.floor((basePaise * GST_BPS) / 10_000);
}

/** Base price for a plan and interval, before GST. */
export function subscriptionBasePaise(plan: SubscribablePlan, interval: BillingInterval): number {
  if (interval === "monthly") return PLAN_PRICES_PAISE[plan];
  const yearly = PLAN_PRICES_YEARLY_PAISE[plan];
  if (yearly === undefined) throw new Error(`No yearly price for ${plan}`);
  return yearly;
}

/** What Razorpay charges per cycle: base + 18% GST. This is the Razorpay plan `amount`. */
export function subscriptionChargePaise(plan: SubscribablePlan, interval: BillingInterval): number {
  const base = subscriptionBasePaise(plan, interval);
  return base + gstPaise(base);
}

/** Razorpay subscription statuses. `expired` is a `created` sub nobody paid. */
export type SubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "cancelled"
  | "completed"
  | "expired"
  | "paused";

/** Statuses in which a subscription is still collecting (or about to collect) money. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["authenticated", "active", "pending"];

export const SUBSCRIPTION_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
] as const;
export type SubscriptionEventName = (typeof SUBSCRIPTION_EVENTS)[number];

export function isSubscriptionEvent(event: string): event is SubscriptionEventName {
  return (SUBSCRIPTION_EVENTS as readonly string[]).includes(event);
}

/** The subscription entity as the webhook (or a fetch) reports it, already parsed. */
export type SubscriptionSnapshot = {
  id: string;
  status: string;
  /** Our plan for its `plan_id`, or null when the id isn't one of ours. */
  mapped: { plan: Plan; interval: BillingInterval } | null;
  currentEnd: Date | null;
  startAt: Date | null;
  paidCount: number | null;
};

/** The vendor's stored billing state before the event. */
export type BillingState = {
  plan: Plan;
  planExpiresAt: Date | null;
  razorpaySubId: string | null;
};

export type BillingPatch = {
  vendor?: { plan?: Plan; planExpiresAt?: Date | null };
  settings?: {
    razorpaySubId?: string | null;
    razorpaySubStatus?: string;
    razorpaySubCancelAtEnd?: boolean;
    billingInterval?: BillingInterval;
  };
};

function laterOf(a: Date | null, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b;
}

/**
 * The patch one subscription event applies to a vendor. Returns an empty
 * patch when the event changes nothing (e.g. an unknown `plan_id`).
 */
export function applySubscriptionEvent(
  current: BillingState,
  event: SubscriptionEventName,
  sub: SubscriptionSnapshot,
  now: Date = new Date(),
): BillingPatch {
  const isCurrentSub = current.razorpaySubId === sub.id;

  switch (event) {
    case "subscription.activated":
    case "subscription.charged": {
      // A payment went through: this sub becomes the vendor's sub, whatever was on file.
      if (!sub.mapped) return {};
      const patch: BillingPatch = {
        vendor: { plan: sub.mapped.plan },
        settings: {
          razorpaySubId: sub.id,
          razorpaySubStatus: sub.status,
          billingInterval: sub.mapped.interval,
        },
      };
      if (sub.currentEnd) {
        patch.vendor!.planExpiresAt = laterOf(current.planExpiresAt, sub.currentEnd);
      }
      return patch;
    }

    case "subscription.authenticated": {
      // Mandate taken. With a future start_at (subscribed during the trial),
      // grant the plan up to the first charge so the 3-day grace covers a
      // first charge that needs retries.
      if (!sub.mapped) return {};
      const patch: BillingPatch = {
        settings: {
          razorpaySubId: sub.id,
          razorpaySubStatus: sub.status,
          billingInterval: sub.mapped.interval,
        },
      };
      if (sub.startAt && sub.startAt.getTime() > now.getTime()) {
        patch.vendor = {
          plan: sub.mapped.plan,
          planExpiresAt: laterOf(current.planExpiresAt, sub.startAt),
        };
      }
      return patch;
    }

    case "subscription.cancelled":
    case "subscription.completed": {
      const patch: BillingPatch = {};
      if (isCurrentSub) {
        patch.settings = {
          razorpaySubId: null,
          razorpaySubStatus: sub.status,
          razorpaySubCancelAtEnd: false,
        };
      }
      // Never charged: take back what `authenticated` granted, but only if
      // nothing later than its start_at was paid for.
      if (
        event === "subscription.cancelled" &&
        sub.paidCount === 0 &&
        sub.startAt &&
        current.planExpiresAt &&
        current.planExpiresAt.getTime() <= sub.startAt.getTime()
      ) {
        patch.vendor = { plan: "FREE", planExpiresAt: null };
      }
      return patch;
    }

    case "subscription.pending":
    case "subscription.halted":
    case "subscription.paused":
    case "subscription.resumed":
      // Status only. Access runs out lazily at planExpiresAt + grace.
      return isCurrentSub ? { settings: { razorpaySubStatus: sub.status } } : {};
  }
}
