import { describe, expect, it } from "vitest";

import {
  PLAN_EXPIRY_GRACE_DAYS,
  effectivePlan,
  isPlanExpired,
  isPlanInGrace,
  planGraceEndsAt,
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
