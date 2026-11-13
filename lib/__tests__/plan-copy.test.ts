import { describe, expect, it, vi } from "vitest";

import { PLAN_LIMITS, PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE, TRIAL_DAYS } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import {
  MARKETED_PLANS,
  PLAN_COMPARISON,
  PLAN_MARKETING,
  PLANS_FROM,
  TRIAL_THEN_NOTE,
  YEARLY_DISCOUNT,
  YEARLY_MONTHS_FREE,
  type MarketedPlan,
} from "@/lib/plan-copy";

function allCopy(plan: MarketedPlan): string {
  const c = PLAN_MARKETING[plan];
  return [c.label, c.price, c.yearlyPrice, c.yearlyNote, c.trial, c.cta, c.ctaNote, c.teaser, c.summary, ...c.bullets].join(
    "\n",
  );
}

describe("plan marketing copy", () => {
  it("markets Lite, Starter and Pro, cheapest first (FREE is grandfathered)", () => {
    expect([...MARKETED_PLANS]).toEqual(["LITE", "STARTER", "PRO"]);
  });

  it("Starter is the one emphasised plan, and Lite really is weaker", () => {
    expect(MARKETED_PLANS.filter((plan) => PLAN_MARKETING[plan].emphasis)).toEqual(["STARTER"]);
    expect(PLAN_PRICES_PAISE.LITE).toBeLessThan(PLAN_PRICES_PAISE.STARTER);
    expect(PLAN_LIMITS.LITE.monthlyTxnCap).not.toBeNull();
    expect(PLAN_LIMITS.LITE.razorpayLinks).toBe(false);
    expect(PLAN_LIMITS.LITE.csvExport).toBe(false);
    expect(PLAN_LIMITS.LITE.analyticsDays).toBeLessThan(PLAN_LIMITS.STARTER.analyticsDays);
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
      String(limits.aiImagesPerMonth),
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
    expect(allCopy(plan)).not.toMatch(/telugu|tamil/i);
  });

  it("leads with pre-orders, not the counter (docs/ICP.md)", () => {
    const copy = allCopy("STARTER");
    expect(copy).toMatch(/store link/i);
    expect(copy).toMatch(/pre-orders/i);
    expect(copy).not.toMatch(/stall|busy counter/i);
  });

  it("sells the agreed plans", () => {
    const row = (label: string) => PLAN_COMPARISON.find((r) => r.label === label);
    expect(row("Monthly")).toMatchObject({ lite: "₹599", starter: "₹649", pro: "₹1,149" });
    expect(row("Yearly")).toMatchObject({ lite: "₹5,990", starter: "₹6,490", pro: "₹11,490" });
    expect(row("You save yearly")).toMatchObject({ lite: "₹1,198", starter: "₹1,298", pro: "₹2,298" });
    expect(row("Yearly, per month")).toMatchObject({ lite: "₹499", starter: "₹541", pro: "₹958" });
    expect(row("Orders a month")).toMatchObject({ lite: "50", starter: "Unlimited", pro: "Unlimited" });
    expect(row("Sales analytics")).toMatchObject({ lite: "30 days", starter: "90 days", pro: "365 days" });
    expect(row("Online payments (Razorpay)")).toMatchObject({ lite: "No", starter: "Yes", pro: "Yes" });
    expect(row("Counter billing by voice")).toMatchObject({ lite: "No", starter: "Yes", pro: "Yes" });
    expect(row("CSV export")).toMatchObject({ lite: "No", starter: "Yes", pro: "Yes" });
    expect(PLAN_LIMITS.LITE.aiImagesPerMonth).toBe(0);
    expect(PLAN_LIMITS.STARTER.aiImagesPerMonth).toBe(30);
    expect(PLAN_LIMITS.PRO.aiImagesPerMonth).toBe(100);
  });

  it("the yearly discount is the months free as a share of twelve", () => {
    expect(YEARLY_DISCOUNT).toBe(`${Math.floor((YEARLY_MONTHS_FREE * 1000) / 12 + 0.5) / 10}% off`);
  });

  it("only advertises AI images once the controls are on", async () => {
    expect(PLAN_COMPARISON.some((r) => /AI images/.test(r.label))).toBe(false);
    for (const plan of MARKETED_PLANS) expect(allCopy(plan)).not.toMatch(/AI image/);

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_AI_IMAGES_ENABLED", "true");
    const on = await import("@/lib/plan-copy");
    vi.unstubAllEnvs();
    expect(on.PLAN_COMPARISON.find((r) => /AI images/.test(r.label))).toMatchObject({
      lite: "None",
      starter: "30",
      pro: "100",
    });
    expect(on.PLAN_MARKETING.LITE.bullets.join()).not.toMatch(/AI image/);
    expect(on.PLAN_MARKETING.STARTER.bullets).toContain("30 AI images a month");
    expect(on.PLAN_MARKETING.PRO.bullets).toContain("100 AI images a month");
  });

  it("Starter mentions CSV iff PLAN_LIMITS.STARTER.csvExport", () => {
    expect(/csv/i.test(allCopy("STARTER"))).toBe(PLAN_LIMITS.STARTER.csvExport);
  });
});

describe("TRIAL_THEN_NOTE", () => {
  it("anchors on the cheapest plan, not Starter", () => {
    const cheapest = Math.min(...MARKETED_PLANS.map((p) => PLAN_PRICES_PAISE[p]));
    expect(PLANS_FROM).toBe(formatINRCompact(cheapest));
    expect(TRIAL_THEN_NOTE).toBe(`No card needed. Then plans from ${formatINRCompact(cheapest)}/month + GST.`);
  });
});
