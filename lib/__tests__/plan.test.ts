import { describe, expect, it } from "vitest";

import {
  PLAN_EXPIRY_GRACE_DAYS,
  TRIAL_PLAN,
  billingAccess,
  effectivePlan,
  isBillingLocked,
  isPlanExpired,
  isPlanInGrace,
  planGraceEndsAt,
  trialDaysLeft,
} from "@/lib/plan";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES = new Date("2026-06-01T00:00:00.000Z");
const GRACE_END = new Date(EXPIRES.getTime() + PLAN_EXPIRY_GRACE_DAYS * DAY_MS);

describe("effectivePlan", () => {
  it("FREE stays FREE, with or without an expiry", () => {
    expect(effectivePlan({ plan: "FREE", planExpiresAt: null })).toBe("FREE");
    expect(effectivePlan({ plan: "FREE", planExpiresAt: EXPIRES }, new Date("2026-10-08"))).toBe("FREE");
    expect(isPlanExpired({ plan: "FREE", planExpiresAt: EXPIRES }, new Date("2026-10-08"))).toBe(false);
  });

  it("null planExpiresAt means no expiry", () => {
    const v = { plan: "PRO" as const, planExpiresAt: null };
    expect(effectivePlan(v, new Date("2099-01-01"))).toBe("PRO");
    expect(isPlanExpired(v, new Date("2099-01-01"))).toBe(false);
    expect(isPlanInGrace(v, new Date("2099-01-01"))).toBe(false);
    expect(planGraceEndsAt(v)).toBeNull();
  });

  it("keeps the plan before planExpiresAt", () => {
    const v = { plan: "STARTER" as const, planExpiresAt: EXPIRES };
    expect(effectivePlan(v, new Date(EXPIRES.getTime() - 1))).toBe("STARTER");
    expect(isPlanInGrace(v, new Date(EXPIRES.getTime() - 1))).toBe(false);
  });

  it("keeps the plan inside the grace window (late renewal webhook)", () => {
    const v = { plan: "PRO" as const, planExpiresAt: EXPIRES };
    const now = new Date(EXPIRES.getTime() + DAY_MS);
    expect(effectivePlan(v, now)).toBe("PRO");
    expect(isPlanExpired(v, now)).toBe(false);
    expect(isPlanInGrace(v, now)).toBe(true);
  });

  it("boundary: exactly at expiry + grace still counts, 1 ms later is FREE", () => {
    const v = { plan: "PRO" as const, planExpiresAt: EXPIRES };
    expect(planGraceEndsAt(v)).toEqual(GRACE_END);
    expect(effectivePlan(v, GRACE_END)).toBe("PRO");
    expect(isPlanInGrace(v, GRACE_END)).toBe(true);

    const after = new Date(GRACE_END.getTime() + 1);
    expect(effectivePlan(v, after)).toBe("FREE");
    expect(isPlanExpired(v, after)).toBe(true);
    expect(isPlanInGrace(v, after)).toBe(false);
  });

  it("the reported bug: PRO expiring 01/06/2026 is FREE on 08/10/2026", () => {
    expect(
      effectivePlan({ plan: "PRO", planExpiresAt: EXPIRES }, new Date("2026-10-08T06:00:00.000Z")),
    ).toBe("FREE");
  });
});

describe("billingAccess (trial / locked / free)", () => {
  const NOW = new Date("2026-10-10T06:30:00.000Z");
  const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

  it("no trial and no paid plan is the grandfathered free tier, never locked", () => {
    const v = { plan: "FREE" as const, planExpiresAt: null, trialEndsAt: null };
    expect(billingAccess(v, NOW)).toEqual({ kind: "free" });
    expect(billingAccess({ plan: "FREE", planExpiresAt: null }, NOW)).toEqual({ kind: "free" });
    expect(effectivePlan(v, NOW)).toBe("FREE");
    expect(isBillingLocked(v, days(10_000))).toBe(false);
  });

  it("during the trial the vendor has STARTER limits", () => {
    const v = { plan: "FREE" as const, planExpiresAt: null, trialEndsAt: days(30) };
    expect(billingAccess(v, NOW)).toEqual({ kind: "trial", endsAt: days(30) });
    expect(effectivePlan(v, NOW)).toBe(TRIAL_PLAN);
    expect(TRIAL_PLAN).toBe("STARTER");
    expect(billingAccess(v, new Date(days(30).getTime() - 1)).kind).toBe("trial");
  });

  it("locks at trialEndsAt with no grace, and reads as FREE", () => {
    const v = { plan: "FREE" as const, planExpiresAt: null, trialEndsAt: days(30) };
    expect(billingAccess(v, days(30))).toEqual({ kind: "locked", since: days(30) });
    expect(effectivePlan(v, days(30))).toBe("FREE");
    expect(isBillingLocked(v, days(31))).toBe(true);
  });

  it("paid wins over trial and over a passed trial", () => {
    const inTrial = { plan: "STARTER" as const, planExpiresAt: days(40), trialEndsAt: days(10) };
    expect(billingAccess(inTrial, NOW)).toEqual({ kind: "paid", plan: "STARTER" });
    expect(billingAccess(inTrial, days(20))).toEqual({ kind: "paid", plan: "STARTER" });
    const manual = { plan: "PRO" as const, planExpiresAt: null, trialEndsAt: days(-100) };
    expect(billingAccess(manual, NOW)).toEqual({ kind: "paid", plan: "PRO" });
  });

  it("a lapsed subscriber from the trial cohort is locked after the grace window", () => {
    const v = { plan: "STARTER" as const, planExpiresAt: days(-1), trialEndsAt: days(-60) };
    expect(billingAccess(v, NOW)).toEqual({ kind: "paid", plan: "STARTER" }); // in grace
    const graceEnd = new Date(days(-1).getTime() + PLAN_EXPIRY_GRACE_DAYS * DAY_MS);
    expect(billingAccess(v, new Date(graceEnd.getTime() + 1))).toEqual({ kind: "locked", since: graceEnd });
  });

  it("a lapsed grandfathered subscriber falls back to free, not locked", () => {
    const v = { plan: "STARTER" as const, planExpiresAt: days(-30), trialEndsAt: null };
    expect(billingAccess(v, NOW)).toEqual({ kind: "free" });
    expect(effectivePlan(v, NOW)).toBe("FREE");
  });

  it("subscribed during the trial, first charge fails: grace then lock from grace end", () => {
    // `authenticated` set planExpiresAt = trialEndsAt (lib/subscription.ts).
    const v = { plan: "STARTER" as const, planExpiresAt: days(5), trialEndsAt: days(5) };
    expect(billingAccess(v, days(6)).kind).toBe("paid");
    const graceEnd = new Date(days(5).getTime() + PLAN_EXPIRY_GRACE_DAYS * DAY_MS);
    expect(billingAccess(v, days(9))).toEqual({ kind: "locked", since: graceEnd });
  });

  it("trialDaysLeft rounds up and bottoms out at 0", () => {
    expect(trialDaysLeft(days(30), NOW)).toBe(30);
    expect(trialDaysLeft(new Date(NOW.getTime() + 1), NOW)).toBe(1);
    expect(trialDaysLeft(days(4.2), NOW)).toBe(5);
    expect(trialDaysLeft(days(-3), NOW)).toBe(0);
  });
});
