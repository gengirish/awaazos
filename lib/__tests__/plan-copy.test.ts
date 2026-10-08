import { describe, expect, it } from "vitest";

import { PLAN_LIMITS, PLAN_PRICES_PAISE } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import { MARKETED_PLANS, PLAN_MARKETING, type MarketedPlan } from "@/lib/plan-copy";

function allCopy(plan: MarketedPlan): string {
  const c = PLAN_MARKETING[plan];
  return [c.label, c.price, c.teaser, c.summary, ...c.bullets].join("\n");
}

describe("plan marketing copy", () => {
  it("markets only FREE and STARTER (PRO is not sold)", () => {
    expect([...MARKETED_PLANS]).toEqual(["FREE", "STARTER"]);
  });

  it.each(MARKETED_PLANS)("%s copy matches PLAN_LIMITS numbers", (plan) => {
    const limits = PLAN_LIMITS[plan];
    const copy = PLAN_MARKETING[plan];
    const text = allCopy(plan);

    expect(copy.label).toBe(limits.label);
    expect(copy.amount).toBe(formatINRCompact(PLAN_PRICES_PAISE[plan]));

    expect(limits.monthlyTxnCap).not.toBeNull();
    expect(copy.bullets).toContain(`${limits.monthlyTxnCap} bills a month`);
    expect(copy.bullets).toContain(`${limits.analyticsDays} days of sales analytics`);

    // Every number in the copy must be one PLAN_LIMITS / price actually holds.
    const allowed = new Set([
      String(limits.monthlyTxnCap),
      String(limits.analyticsDays),
      String(PLAN_PRICES_PAISE[plan] / 100),
    ]);
    for (const n of text.match(/\d+/g) ?? []) {
      expect(allowed, `unexpected number "${n}" in ${plan} copy`).toContain(n);
    }
  });

  it.each(MARKETED_PLANS)("%s copy never promises staff logins (maxStaff is unenforced)", (plan) => {
    expect(allCopy(plan)).not.toMatch(/staff/i);
  });

  it.each(MARKETED_PLANS)("%s copy only offers the voice languages in the picker", (plan) => {
    expect(allCopy(plan)).not.toMatch(/telugu|kannada|tamil/i);
  });

  it("Starter mentions CSV iff PLAN_LIMITS.STARTER.csvExport", () => {
    expect(/csv/i.test(allCopy("STARTER"))).toBe(PLAN_LIMITS.STARTER.csvExport);
  });

  it("Free mentions CSV iff PLAN_LIMITS.FREE.csvExport", () => {
    expect(/csv/i.test(allCopy("FREE"))).toBe(PLAN_LIMITS.FREE.csvExport);
  });
});
