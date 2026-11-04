import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    throw new Error(`Unexpected requireEnv(${key})`);
  },
}));

import { PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";
import { ownerSurveySchema, summariseSurvey, type OwnerSurveyAnswers } from "@/lib/owner-survey";
import { toSubscriptionSnapshot } from "@/lib/razorpay";
import { chargeBasePaise } from "@/lib/sales-earnings";
import {
  applySubscriptionEvent,
  isValidCustomPriceRupees,
  storeBasePaise,
  storeChargePaise,
  subscriptionChargePaise,
} from "@/lib/subscription";

const VALID = {
  pains: ["payment_matching", "delivery"],
  topPain: "delivery",
  weeklyOrders: "10_30",
  willingToPay: "199_499",
};

describe("ownerSurveySchema", () => {
  it("accepts a full answer and turns a blank comment into null", () => {
    expect(ownerSurveySchema.parse({ ...VALID, comment: "   " }).comment).toBeNull();
    expect(ownerSurveySchema.parse(VALID).comment).toBeNull();
    expect(ownerSurveySchema.parse({ ...VALID, comment: " more " }).comment).toBe("more");
  });

  it("rejects a top pain that wasn't chosen, repeats, no pains and unknown keys", () => {
    expect(ownerSurveySchema.safeParse({ ...VALID, topPain: "profit" }).success).toBe(false);
    expect(ownerSurveySchema.safeParse({ ...VALID, pains: ["delivery", "delivery"] }).success).toBe(false);
    expect(ownerSurveySchema.safeParse({ ...VALID, pains: [] }).success).toBe(false);
    expect(ownerSurveySchema.safeParse({ ...VALID, pains: ["made_up"], topPain: "made_up" }).success).toBe(false);
    expect(ownerSurveySchema.safeParse({ ...VALID, willingToPay: "lots" }).success).toBe(false);
    expect(ownerSurveySchema.safeParse({ ...VALID, comment: "x".repeat(501) }).success).toBe(false);
  });
});

describe("summariseSurvey", () => {
  const row = (pains: string[], topPain: string): OwnerSurveyAnswers => ({
    pains,
    topPain,
    weeklyOrders: "10_30",
    willingToPay: "nothing_yet",
    comment: null,
  });

  it("ranks what hurts most above what is merely named", () => {
    const summary = summariseSurvey([
      row(["delivery", "profit"], "delivery"),
      row(["profit"], "profit"),
      row(["profit", "delivery"], "delivery"),
    ]);
    expect(summary.responses).toBe(3);
    expect(summary.pains.map((p) => [p.key, p.top, p.named])).toEqual([
      ["delivery", 2, 2],
      ["profit", 1, 3],
    ]);
    expect(summary.weeklyOrders.find((b) => b.key === "10_30")?.count).toBe(3);
    expect(summary.willingToPay.find((b) => b.key === "over_999")?.count).toBe(0);
  });

  it("keeps an answer whose key has left the list", () => {
    const summary = summariseSurvey([row(["old_key"], "old_key")]);
    expect(summary.pains[0]).toMatchObject({ key: "old_key", label: "old_key", top: 1 });
  });
});

describe("store price", () => {
  it("uses the list price when no custom price is set", () => {
    expect(storeBasePaise("monthly", null)).toBe(PLAN_PRICES_PAISE.STARTER);
    expect(storeBasePaise("yearly", null)).toBe(PLAN_PRICES_YEARLY_PAISE.STARTER);
    expect(storeChargePaise("monthly", null)).toBe(subscriptionChargePaise("STARTER", "monthly"));
  });

  it("makes a year ten months and adds GST", () => {
    expect(storeBasePaise("monthly", 19900)).toBe(19900);
    expect(storeBasePaise("yearly", 19900)).toBe(199000);
    expect(storeChargePaise("monthly", 19900)).toBe(23482);
    expect(storeChargePaise("yearly", 19900)).toBe(234820);
  });

  it("allows whole rupees in range only", () => {
    expect(isValidCustomPriceRupees(49)).toBe(true);
    expect(isValidCustomPriceRupees(4999)).toBe(true);
    expect(isValidCustomPriceRupees(48)).toBe(false);
    expect(isValidCustomPriceRupees(5000)).toBe(false);
    expect(isValidCustomPriceRupees(199.5)).toBe(false);
    expect(isValidCustomPriceRupees(Number.NaN)).toBe(false);
  });

  it("gets the exact base back from every charge, for the sales share", () => {
    for (let rupees = 49; rupees <= 4999; rupees++) {
      const paise = rupees * 100;
      expect(chargeBasePaise(storeChargePaise("monthly", paise))).toBe(paise);
    }
  });
});

describe("a charge on a custom-price plan", () => {
  const entity = {
    status: "active",
    plan_id: "plan_custom_not_in_env",
    current_end: 1_800_000_000,
    notes: { vendorId: "v1", plan: "STARTER", interval: "yearly" },
  };

  it("is mapped from the subscription's notes and grants the plan", () => {
    const sub = toSubscriptionSnapshot("sub_1", entity);
    expect(sub.mapped).toEqual({ plan: "STARTER", interval: "yearly" });
    const patch = applySubscriptionEvent(
      { plan: "FREE", planExpiresAt: null, razorpaySubId: "sub_1" },
      "subscription.charged",
      sub,
    );
    expect(patch.vendor?.plan).toBe("STARTER");
    expect(patch.settings?.billingInterval).toBe("yearly");
  });

  it("stays unmapped with no notes or notes we didn't write", () => {
    for (const notes of [undefined, { vendorId: "v1" }, { plan: "PRO", interval: "monthly" }, { plan: "STARTER", interval: "weekly" }]) {
      expect(toSubscriptionSnapshot("sub_1", { ...entity, notes }).mapped).toBeNull();
    }
  });
});
