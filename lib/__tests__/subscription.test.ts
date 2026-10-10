import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    throw new Error(`Unexpected requireEnv(${key})`);
  },
}));

import { GST_BPS, PLAN_PRICES_PAISE } from "@/lib/constants";
import { getRazorpayPlanId, planFromRazorpayPlanId } from "@/lib/razorpay";
import {
  applySubscriptionEvent,
  gstPaise,
  isSubscriptionEvent,
  subscriptionBasePaise,
  subscriptionChargePaise,
  type BillingState,
  type SubscriptionSnapshot,
} from "@/lib/subscription";

const NOW = new Date("2026-10-10T06:30:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const STARTER_MONTHLY = { plan: "STARTER" as const, interval: "monthly" as const };

function sub(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    id: "sub_A",
    status: "active",
    mapped: STARTER_MONTHLY,
    currentEnd: day(30),
    startAt: null,
    paidCount: 1,
    ...over,
  };
}

const free: BillingState = { plan: "FREE", planExpiresAt: null, razorpaySubId: "sub_A" };

describe("prices", () => {
  it("GST is 18% in basis points, floored", () => {
    expect(GST_BPS).toBe(1800);
    expect(gstPaise(29900)).toBe(5382);
    expect(gstPaise(299000)).toBe(53820);
    expect(gstPaise(1)).toBe(0);
  });

  it("Razorpay plan amounts are base + GST", () => {
    expect(subscriptionBasePaise("STARTER", "monthly")).toBe(PLAN_PRICES_PAISE.STARTER);
    expect(subscriptionChargePaise("STARTER", "monthly")).toBe(35282);
    expect(subscriptionBasePaise("STARTER", "yearly")).toBe(299000);
    expect(subscriptionChargePaise("STARTER", "yearly")).toBe(352820);
  });

  it("yearly is 10× monthly (two months free)", () => {
    expect(subscriptionBasePaise("STARTER", "yearly")).toBe(10 * subscriptionBasePaise("STARTER", "monthly"));
  });
});

describe("isSubscriptionEvent", () => {
  it("accepts subscription.* events it handles and nothing else", () => {
    expect(isSubscriptionEvent("subscription.charged")).toBe(true);
    expect(isSubscriptionEvent("payment.captured")).toBe(false);
    expect(isSubscriptionEvent("subscription.unknown")).toBe(false);
  });
});

describe("applySubscriptionEvent", () => {
  it("activated sets plan, expiry from current_end, id, status and interval", () => {
    expect(applySubscriptionEvent(free, "subscription.activated", sub(), NOW)).toEqual({
      vendor: { plan: "STARTER", planExpiresAt: day(30) },
      settings: { razorpaySubId: "sub_A", razorpaySubStatus: "active", billingInterval: "monthly" },
    });
  });

  it("charged before activated lands in the same state (out-of-order delivery)", () => {
    const charged = applySubscriptionEvent(free, "subscription.charged", sub(), NOW);
    const activated = applySubscriptionEvent(free, "subscription.activated", sub(), NOW);
    expect(charged).toEqual(activated);
  });

  it("is idempotent: replaying charged on the state it produced changes nothing", () => {
    const first = applySubscriptionEvent(free, "subscription.charged", sub(), NOW);
    const after: BillingState = {
      plan: first.vendor!.plan!,
      planExpiresAt: first.vendor!.planExpiresAt!,
      razorpaySubId: first.settings!.razorpaySubId!,
    };
    const again = applySubscriptionEvent(after, "subscription.charged", sub(), NOW);
    expect(again.vendor).toEqual({ plan: "STARTER", planExpiresAt: day(30) });
  });

  it("never moves planExpiresAt backwards (stale event after a renewal)", () => {
    const renewed: BillingState = { plan: "STARTER", planExpiresAt: day(60), razorpaySubId: "sub_A" };
    const p = applySubscriptionEvent(renewed, "subscription.charged", sub({ currentEnd: day(30) }), NOW);
    expect(p.vendor?.planExpiresAt).toEqual(day(60));
  });

  it("yearly charge extends by Razorpay's period, not 30 days", () => {
    const p = applySubscriptionEvent(
      free,
      "subscription.charged",
      sub({ mapped: { plan: "STARTER", interval: "yearly" }, currentEnd: day(365) }),
      NOW,
    );
    expect(p.vendor?.planExpiresAt).toEqual(day(365));
    expect(p.settings?.billingInterval).toBe("yearly");
  });

  it("ignores activated/charged for a plan_id that isn't ours", () => {
    expect(applySubscriptionEvent(free, "subscription.charged", sub({ mapped: null }), NOW)).toEqual({});
  });

  it("a payment on a different sub than the one on file adopts it", () => {
    const p = applySubscriptionEvent(
      { ...free, razorpaySubId: "sub_OLD" },
      "subscription.charged",
      sub(),
      NOW,
    );
    expect(p.settings?.razorpaySubId).toBe("sub_A");
  });

  it("authenticated with a future start_at grants the plan up to the first charge", () => {
    const p = applySubscriptionEvent(
      free,
      "subscription.authenticated",
      sub({ status: "authenticated", startAt: day(20), currentEnd: null, paidCount: 0 }),
      NOW,
    );
    expect(p.vendor).toEqual({ plan: "STARTER", planExpiresAt: day(20) });
    expect(p.settings?.razorpaySubStatus).toBe("authenticated");
  });

  it("authenticated without a future start_at only records status", () => {
    const p = applySubscriptionEvent(
      free,
      "subscription.authenticated",
      sub({ status: "authenticated", startAt: null, paidCount: 0 }),
      NOW,
    );
    expect(p.vendor).toBeUndefined();
  });

  it("cancelled keeps the paid period and clears the id", () => {
    const paid: BillingState = { plan: "STARTER", planExpiresAt: day(12), razorpaySubId: "sub_A" };
    const p = applySubscriptionEvent(paid, "subscription.cancelled", sub({ status: "cancelled" }), NOW);
    expect(p.vendor).toBeUndefined();
    expect(p.settings).toEqual({
      razorpaySubId: null,
      razorpaySubStatus: "cancelled",
      razorpaySubCancelAtEnd: false,
    });
  });

  it("cancelled before the first charge takes back what authenticated granted", () => {
    const granted: BillingState = { plan: "STARTER", planExpiresAt: day(20), razorpaySubId: "sub_A" };
    const p = applySubscriptionEvent(
      granted,
      "subscription.cancelled",
      sub({ status: "cancelled", startAt: day(20), paidCount: 0 }),
      NOW,
    );
    expect(p.vendor).toEqual({ plan: "FREE", planExpiresAt: null });
  });

  it("an uncharged cancel never takes back a period paid by another sub", () => {
    const paidElsewhere: BillingState = { plan: "STARTER", planExpiresAt: day(40), razorpaySubId: "sub_B" };
    const p = applySubscriptionEvent(
      paidElsewhere,
      "subscription.cancelled",
      sub({ status: "cancelled", startAt: day(20), paidCount: 0 }),
      NOW,
    );
    expect(p).toEqual({});
  });

  it("cancelled for an old sub doesn't clear the current one", () => {
    const p = applySubscriptionEvent(
      { ...free, razorpaySubId: "sub_NEW" },
      "subscription.cancelled",
      sub({ status: "cancelled" }),
      NOW,
    );
    expect(p.settings).toBeUndefined();
  });

  it.each(["subscription.pending", "subscription.halted", "subscription.paused", "subscription.resumed"] as const)(
    "%s records status only and never downgrades",
    (event) => {
      const paid: BillingState = { plan: "STARTER", planExpiresAt: day(2), razorpaySubId: "sub_A" };
      const p = applySubscriptionEvent(paid, event, sub({ status: "halted" }), NOW);
      expect(p).toEqual({ settings: { razorpaySubStatus: "halted" } });
    },
  );

  it("status events for another sub are ignored", () => {
    const p = applySubscriptionEvent(
      { ...free, razorpaySubId: "sub_NEW" },
      "subscription.halted",
      sub({ status: "halted" }),
      NOW,
    );
    expect(p).toEqual({});
  });
});

describe("Razorpay plan ids", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps monthly, yearly, the legacy monthly name and PRO", () => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_MONTHLY", "plan_m");
    vi.stubEnv("RAZORPAY_PLAN_STARTER_YEARLY", "plan_y");
    vi.stubEnv("RAZORPAY_PLAN_STARTER", "plan_legacy");
    vi.stubEnv("RAZORPAY_PLAN_PRO", "plan_pro");
    expect(planFromRazorpayPlanId("plan_m")).toEqual({ plan: "STARTER", interval: "monthly" });
    expect(planFromRazorpayPlanId("plan_y")).toEqual({ plan: "STARTER", interval: "yearly" });
    expect(planFromRazorpayPlanId("plan_legacy")).toEqual({ plan: "STARTER", interval: "monthly" });
    expect(planFromRazorpayPlanId("plan_pro")).toEqual({ plan: "PRO", interval: "monthly" });
    expect(planFromRazorpayPlanId("plan_other")).toBeNull();
    expect(planFromRazorpayPlanId("")).toBeNull();
  });

  it("unset env never matches an empty or undefined plan id", () => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_YEARLY", "");
    expect(planFromRazorpayPlanId("")).toBeNull();
  });

  it("monthly falls back to the legacy RAZORPAY_PLAN_STARTER", () => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_MONTHLY", "");
    vi.stubEnv("RAZORPAY_PLAN_STARTER", "plan_legacy");
    expect(getRazorpayPlanId("STARTER", "monthly")).toBe("plan_legacy");
  });

  it("throws when the yearly plan isn't configured", () => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_YEARLY", "");
    expect(() => getRazorpayPlanId("STARTER", "yearly")).toThrow(/RAZORPAY_PLAN_STARTER_YEARLY/);
  });
});
