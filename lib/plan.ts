/**
 * Billing access, evaluated lazily on read (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md).
 *
 * `Vendor.plan` / `planExpiresAt` are what was last *paid for* (written by the
 * Razorpay subscription webhook, or by hand). `Vendor.trialEndsAt` is set at
 * sign-up. Nothing flips a stored value when a date passes — there is
 * deliberately no timer (Neon must be able to sleep), so every reader derives
 * the vendor's state from those three fields and "now" here. Pure: never
 * writes a downgrade or a lock back to the database.
 *
 *   paid    a paid plan, not past `planExpiresAt` + grace
 *   trial   not paid, before `trialEndsAt` — STARTER limits
 *   locked  not paid, `trialEndsAt` set and passed — no new sales
 *   free    not paid, `trialEndsAt` null — signed up before the trial existed;
 *           keeps the FREE tier and is never locked
 *
 * `requireVendorRole` already applies this: `ctx.vendor.plan` is the effective
 * plan and `ctx.access` the state. Code that loads a vendor some other way
 * (public storefront, payment routes) must select `planExpiresAt` AND
 * `trialEndsAt` and call `effectivePlan` / `billingAccess`.
 */
import type { Plan } from "@prisma/client";

/**
 * Days a paid plan keeps working after `planExpiresAt`, so a late or retried
 * renewal webhook never downgrades a vendor who is actually paying.
 */
export const PLAN_EXPIRY_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Limits a vendor gets during the free trial. */
export const TRIAL_PLAN: Plan = "STARTER";

export type PlanFields = {
  plan: Plan;
  /** null = no expiry (e.g. a manually assigned plan). */
  planExpiresAt: Date | null;
  /**
   * End of the free trial; null/omitted = no trial (grandfathered FREE vendor).
   * Always pass it from a DB row — leaving it out treats a trial vendor as FREE.
   */
  trialEndsAt?: Date | null;
};

export type BillingAccess =
  | { kind: "paid"; plan: Plan }
  | { kind: "trial"; endsAt: Date }
  | { kind: "locked"; since: Date }
  | { kind: "free" };

/** The instant after which the stored plan stops applying, or null if it never does. */
export function planGraceEndsAt(vendor: PlanFields): Date | null {
  if (vendor.plan === "FREE" || !vendor.planExpiresAt) return null;
  return new Date(vendor.planExpiresAt.getTime() + PLAN_EXPIRY_GRACE_DAYS * DAY_MS);
}

/** True once a paid plan is past `planExpiresAt` + grace. FREE never expires. */
export function isPlanExpired(vendor: PlanFields, now: Date = new Date()): boolean {
  const graceEnd = planGraceEndsAt(vendor);
  return graceEnd !== null && now.getTime() > graceEnd.getTime();
}

/** Past `planExpiresAt` but still inside the grace window (features still on). */
export function isPlanInGrace(vendor: PlanFields, now: Date = new Date()): boolean {
  if (vendor.plan === "FREE" || !vendor.planExpiresAt) return false;
  return now.getTime() > vendor.planExpiresAt.getTime() && !isPlanExpired(vendor, now);
}

/** Where the vendor stands right now. Paid always wins over trial or lock. */
export function billingAccess(vendor: PlanFields, now: Date = new Date()): BillingAccess {
  if (vendor.plan !== "FREE" && !isPlanExpired(vendor, now)) {
    return { kind: "paid", plan: vendor.plan };
  }
  const trialEndsAt = vendor.trialEndsAt ?? null;
  if (!trialEndsAt) return { kind: "free" };
  if (now.getTime() < trialEndsAt.getTime()) return { kind: "trial", endsAt: trialEndsAt };
  // Locked from whichever ended last: the trial, or a paid period (+ grace).
  const graceEnd = planGraceEndsAt(vendor);
  const since = graceEnd && graceEnd.getTime() > trialEndsAt.getTime() ? graceEnd : trialEndsAt;
  return { kind: "locked", since };
}

/** True when the vendor can't make new sales until they subscribe. */
export function isBillingLocked(vendor: PlanFields, now: Date = new Date()): boolean {
  return billingAccess(vendor, now).kind === "locked";
}

/**
 * The plan whose limits apply right now: the paid plan, STARTER during the
 * trial, otherwise FREE. A locked vendor reads as FREE here; what a lock
 * blocks on top of that is `requireActiveBilling` (lib/rbac.ts).
 */
export function effectivePlan(vendor: PlanFields, now: Date = new Date()): Plan {
  const access = billingAccess(vendor, now);
  if (access.kind === "paid") return access.plan;
  return access.kind === "trial" ? TRIAL_PLAN : "FREE";
}

/** Whole days left in the trial, rounded up; 0 once it has ended. */
export function trialDaysLeft(endsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}
