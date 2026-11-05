/**
 * What an owner can do about their subscription right now. Pure and client-safe.
 *
 * The one rule behind the billing page's plan picker and
 * POST /api/razorpay/create-subscription, so the page never offers what the
 * server refuses and the owner is never left with nothing to tap.
 *
 *   renewing (a live subscription that will charge again)
 *     paying: a higher plan replaces it, charged today; nothing else
 *     trial, locked, free: nothing, it is about to start or needs cancelling first
 *   not renewing (cancelled, halted, expired, abandoned checkout, none)
 *     not paying: any plan
 *     paying, higher plan: starts today, charged today
 *     paying, same or lower plan: starts when the paid period ends, nothing today
 *
 * A subscription cancelled "at cycle end" still reads `active` at Razorpay until
 * that day but never charges again, so it is not renewing.
 */
import { PLAN_RANK } from "@/lib/constants";
import type { BillingAccess } from "@/lib/plan";
import {
  BILLING_INTERVALS,
  LIVE_SUBSCRIPTION_STATUSES,
  SUBSCRIBABLE_PLANS,
  type BillingInterval,
  type SubscribablePlan,
} from "@/lib/subscription";

export type SubscriptionFacts = {
  access: BillingAccess;
  planExpiresAt: Date | null;
  razorpaySubId: string | null;
  razorpaySubStatus: string | null;
  razorpaySubCancelAtEnd: boolean;
  customPricePaise: number | null;
};

/** `subscribe`: a first or fresh one. `resubscribe`: picking up after a lapse. `upgrade`: replaces a renewing one. */
export type SubscribeAction = "subscribe" | "resubscribe" | "upgrade";

/** `period_end`: the first charge waits for `planExpiresAt`. `now` also covers the trial, which defers it by itself. */
export type SubscribeStart = "now" | "period_end";

export type SubscribeRefusal = "own_price_starter_only" | "already_on_plan" | "already_subscribed";

export type SubscribeDecision =
  | { ok: true; action: SubscribeAction; start: SubscribeStart }
  | { ok: false; reason: SubscribeRefusal };

export const SUBSCRIBE_REFUSAL_MESSAGE: Record<SubscribeRefusal, string> = {
  own_price_starter_only: "Your store has its own price on the Starter plan.",
  already_on_plan: "You are already on this plan or higher.",
  already_subscribed: "You already have an active subscription.",
};

/** Will this subscription charge again? A row with an id and no status predates the status column. */
export function subscriptionRenews(
  facts: Pick<SubscriptionFacts, "razorpaySubId" | "razorpaySubStatus" | "razorpaySubCancelAtEnd">,
): boolean {
  if (facts.razorpaySubCancelAtEnd) return false;
  if (facts.razorpaySubStatus) return LIVE_SUBSCRIPTION_STATUSES.includes(facts.razorpaySubStatus);
  return Boolean(facts.razorpaySubId);
}

export function subscribeDecision(
  facts: SubscriptionFacts,
  plan: SubscribablePlan,
  now: Date = new Date(),
): SubscribeDecision {
  if (facts.customPricePaise !== null && plan !== "STARTER") {
    return { ok: false, reason: "own_price_starter_only" };
  }
  const renews = subscriptionRenews(facts);
  const { access } = facts;
  if (access.kind !== "paid") {
    return renews ? { ok: false, reason: "already_subscribed" } : { ok: true, action: "subscribe", start: "now" };
  }

  const higher = PLAN_RANK[plan] > PLAN_RANK[access.plan];
  if (renews) {
    return higher ? { ok: true, action: "upgrade", start: "now" } : { ok: false, reason: "already_on_plan" };
  }
  const action: SubscribeAction = facts.razorpaySubStatus ? "resubscribe" : "subscribe";
  if (higher) return { ok: true, action, start: "now" };
  // A plan given by hand with no end date has no period for a new one to follow.
  if (!facts.planExpiresAt) return { ok: false, reason: "already_on_plan" };
  return { ok: true, action, start: facts.planExpiresAt.getTime() > now.getTime() ? "period_end" : "now" };
}

export type PlanOffer = { plan: SubscribablePlan; action: SubscribeAction; start: SubscribeStart };

/** The plans the billing page offers, cheapest first. */
export function plansOnOffer(facts: SubscriptionFacts, now: Date = new Date()): PlanOffer[] {
  const offers: PlanOffer[] = [];
  for (const plan of SUBSCRIBABLE_PLANS) {
    const decision = subscribeDecision(facts, plan, now);
    if (decision.ok) offers.push({ plan, action: decision.action, start: decision.start });
  }
  return offers;
}

export type BillingSelection = { plan: SubscribablePlan | null; interval: BillingInterval | null };

/** Reads `?plan=starter&interval=yearly`. Anything unknown is ignored, never an error. */
export function parseBillingSelection(params: { plan?: unknown; interval?: unknown }): BillingSelection {
  const plan = typeof params.plan === "string" ? params.plan.toUpperCase() : "";
  const interval = typeof params.interval === "string" ? params.interval.toLowerCase() : "";
  return {
    plan: (SUBSCRIBABLE_PLANS as readonly string[]).includes(plan) ? (plan as SubscribablePlan) : null,
    interval: (BILLING_INTERVALS as readonly string[]).includes(interval) ? (interval as BillingInterval) : null,
  };
}

/** Where a pricing card sends someone who has picked a plan and interval. */
export function billingSelectionPath(plan: SubscribablePlan, interval: BillingInterval): string {
  return `/settings/billing?plan=${plan.toLowerCase()}&interval=${interval}`;
}

/** The plan preselected on the page: the one asked for if on offer, else Starter, else the cheapest. */
export function preselectedPlan(
  offers: readonly PlanOffer[],
  requested: SubscribablePlan | null,
): SubscribablePlan | null {
  const offered = (plan: SubscribablePlan | null) => offers.some((o) => o.plan === plan);
  if (requested && offered(requested)) return requested;
  if (offered("STARTER")) return "STARTER";
  return offers[0]?.plan ?? null;
}
