/**
 * Plan expiry, evaluated lazily on read.
 *
 * `Vendor.plan` is what was last *stored* (by the Razorpay subscription
 * webhook or by hand). Nothing flips it back to FREE when `planExpiresAt`
 * passes — there is deliberately no timer (Neon must be able to sleep), so
 * every reader that gates on the plan compares the expiry with "now" here.
 * Pure: never writes the downgrade back to the database.
 *
 * `requireVendorRole` already applies this, so `ctx.vendor.plan` is the
 * effective plan. Code that loads a vendor some other way (public storefront,
 * payment routes) must select `planExpiresAt` and call `effectivePlan`.
 */
import type { Plan } from "@prisma/client";

/**
 * Days a paid plan keeps working after `planExpiresAt`, so a late or retried
 * renewal webhook never downgrades a vendor who is actually paying.
 */
export const PLAN_EXPIRY_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanFields = {
  plan: Plan;
  /** null = no expiry (e.g. a manually assigned plan). */
  planExpiresAt: Date | null;
};

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

/** The plan whose limits apply right now: FREE once the stored plan has expired past grace. */
export function effectivePlan(vendor: PlanFields, now: Date = new Date()): Plan {
  return isPlanExpired(vendor, now) ? "FREE" : vendor.plan;
}
