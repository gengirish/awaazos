import { describe, expect, it } from "vitest";

import { PLAN_LIMITS, PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE, TRIAL_DAYS } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import { MARKETED_PLANS, PLAN_MARKETING, YEARLY_MONTHS_FREE, type MarketedPlan } from "@/lib/plan-copy";

function allCopy(plan: MarketedPlan): string {
  const c = PLAN_MARKETING[plan];
  return [c.label, c.price, c.yearlyPrice, c.yearlyNote, c.trial, c.cta, c.ctaNote, c.teaser, c.summary, ...c.bullets].join(
    "\n",
  );
}

describe("plan marketing copy", () => {
  it("markets only STARTER (FREE is grandfathered, PRO is not sold)", () => {
    expect([...MARKETED_PLANS]).toEqual(["STARTER"]);
  });

  it.each(MARKETED_PLANS)("%s copy matches PLAN_LIMITS, prices and the trial length", (plan) => {
    const limits = PLAN_LIMITS[plan];
    const copy = PLAN_MARKETING[plan];
    const yearlyPaise = PLAN_PRICES_YEARLY_PAISE[plan]!;

    expect(copy.label).toBe(limits.label);
    expect(copy.amount).toBe(formatINRCompact(PLAN_PRICES_PAISE[plan]));
    expect(copy.price).toBe(`${formatINRCompact(PLAN_PRICES_PAISE[plan])}/mo + GST`);
    expect(copy.yearlyPrice).toBe(`${formatINRCompact(yearlyPaise)}/yr + GST`);
    expect(copy.trial).toBe(`${TRIAL_DAYS} days free`);
    expect(copy.cta).toBe(`Start ${TRIAL_DAYS} days free`);
    expect(copy.ctaNote).toBe(`No card needed. Then ${formatINRCompact(PLAN_PRICES_PAISE[plan])}/month + GST.`);

    expect(copy.bullets).toContain(
      limits.monthlyTxnCap === null
        ? "Unlimited orders and bills"
        : `${limits.monthlyTxnCap} orders and bills a month`,
    );
    expect(copy.bullets).toContain(`${limits.analyticsDays} days of sales analytics`);

    // Every number in the copy must be one PLAN_LIMITS / a price / the trial actually holds.
    const allowed = new Set([
      String(limits.monthlyTxnCap),
      String(limits.analyticsDays),
      String(PLAN_PRICES_PAISE[plan] / 100),
      String(yearlyPaise / 100),
      String(TRIAL_DAYS),
      String(YEARLY_MONTHS_FREE),
    ]);
    for (const n of allCopy(plan).replace(/,(?=\d{3})/g, "").match(/\d+/g) ?? []) {
      expect(allowed, `unexpected number "${n}" in ${plan} copy`).toContain(n);
    }
  });

  it("yearly saves the whole months the copy claims", () => {
    const monthly = PLAN_PRICES_PAISE.STARTER;
    const yearly = PLAN_PRICES_YEARLY_PAISE.STARTER!;
    expect(YEARLY_MONTHS_FREE).toBe(2);
    expect(12 * monthly - yearly).toBe(YEARLY_MONTHS_FREE * monthly);
    expect(PLAN_MARKETING.STARTER.yearlyNote).toBe("2 months free");
  });

  it.each(MARKETED_PLANS)("%s prices say + GST (prices exclude GST)", (plan) => {
    expect(PLAN_MARKETING[plan].price.endsWith("+ GST")).toBe(true);
    expect(PLAN_MARKETING[plan].yearlyPrice.endsWith("+ GST")).toBe(true);
    expect(PLAN_MARKETING[plan].taxNote).toBe("+ GST");
  });

  it("Starter is unlimited (matches the trial)", () => {
    expect(PLAN_LIMITS.STARTER.monthlyTxnCap).toBeNull();
  });

  it.each(MARKETED_PLANS)("%s copy never promises staff logins (maxStaff is unenforced)", (plan) => {
    expect(allCopy(plan)).not.toMatch(/staff/i);
  });

  it.each(MARKETED_PLANS)("%s copy only offers the voice languages in the picker", (plan) => {
    expect(allCopy(plan)).not.toMatch(/telugu|kannada|tamil/i);
  });

  it("leads with pre-orders, not the counter (docs/ICP.md)", () => {
    const copy = allCopy("STARTER");
    expect(copy).toMatch(/store link/i);
    expect(copy).toMatch(/drops/i);
    expect(copy).not.toMatch(/stall|busy counter/i);
  });

  it("Starter mentions CSV iff PLAN_LIMITS.STARTER.csvExport", () => {
    expect(/csv/i.test(allCopy("STARTER"))).toBe(PLAN_LIMITS.STARTER.csvExport);
  });
});
