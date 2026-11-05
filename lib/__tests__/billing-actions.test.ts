import { describe, expect, it } from "vitest";

import {
  billingSelectionPath,
  parseBillingSelection,
  plansOnOffer,
  preselectedPlan,
  subscribeDecision,
  subscriptionRenews,
  type SubscriptionFacts,
} from "@/lib/billing-actions";
import type { BillingAccess } from "@/lib/plan";

const NOW = new Date("2026-11-05T06:00:00.000Z");
const LATER = new Date("2026-11-10T06:00:00.000Z");
const EARLIER = new Date("2026-11-04T06:00:00.000Z");

const TRIAL: BillingAccess = { kind: "trial", endsAt: LATER };
const LOCKED: BillingAccess = { kind: "locked", since: EARLIER };
const FREE: BillingAccess = { kind: "free" };
const PAID_LITE: BillingAccess = { kind: "paid", plan: "LITE" };
const PAID_STARTER: BillingAccess = { kind: "paid", plan: "STARTER" };
const PAID_PRO: BillingAccess = { kind: "paid", plan: "PRO" };

function facts(over: Partial<SubscriptionFacts>): SubscriptionFacts {
  return {
    access: TRIAL,
    planExpiresAt: null,
    razorpaySubId: null,
    razorpaySubStatus: null,
    razorpaySubCancelAtEnd: false,
    customPricePaise: null,
    ...over,
  };
}

function offered(f: SubscriptionFacts) {
  return plansOnOffer(f, NOW).map((o) => `${o.plan}:${o.action}:${o.start}`);
}

const ALL_FRESH = ["LITE:subscribe:now", "STARTER:subscribe:now", "PRO:subscribe:now"];
const NOT_LIVE = ["created", "halted", "cancelled", "completed", "expired", "paused"];
const LIVE = ["authenticated", "active", "pending"];

describe("not paying: trial, locked, free", () => {
  for (const [name, access] of [
    ["trial", TRIAL],
    ["locked", LOCKED],
    ["free", FREE],
  ] as const) {
    it(`${name} with no subscription is offered every plan`, () => {
      expect(offered(facts({ access }))).toEqual(ALL_FRESH);
    });

    for (const status of NOT_LIVE) {
      it(`${name} with a ${status} subscription is offered every plan`, () => {
        expect(offered(facts({ access, razorpaySubId: "sub_1", razorpaySubStatus: status }))).toEqual(ALL_FRESH);
      });
    }

    for (const status of LIVE) {
      it(`${name} with a ${status} subscription can't start a second one`, () => {
        const f = facts({ access, razorpaySubId: "sub_1", razorpaySubStatus: status });
        expect(offered(f)).toEqual([]);
        expect(subscribeDecision(f, "STARTER", NOW)).toEqual({ ok: false, reason: "already_subscribed" });
      });
    }
  }

  it("locked with a cancel-at-end sub whose last webhook was lost is not a dead end", () => {
    const f = facts({
      access: LOCKED,
      razorpaySubId: "sub_1",
      razorpaySubStatus: "active",
      razorpaySubCancelAtEnd: true,
    });
    expect(offered(f)).toEqual(ALL_FRESH);
  });
});

describe("paying, subscription renewing", () => {
  for (const status of LIVE) {
    it(`${status}: only a higher plan, which replaces it`, () => {
      const f = facts({
        access: PAID_LITE,
        planExpiresAt: LATER,
        razorpaySubId: "sub_1",
        razorpaySubStatus: status,
      });
      expect(offered(f)).toEqual(["STARTER:upgrade:now", "PRO:upgrade:now"]);
      expect(subscribeDecision(f, "LITE", NOW)).toEqual({ ok: false, reason: "already_on_plan" });
    });
  }

  it("the top plan has nothing to buy; cancelling is the way out", () => {
    const f = facts({ access: PAID_PRO, planExpiresAt: LATER, razorpaySubId: "sub_1", razorpaySubStatus: "active" });
    expect(offered(f)).toEqual([]);
  });

  it("a sub from before the status column counts as renewing", () => {
    const f = facts({ access: PAID_STARTER, planExpiresAt: LATER, razorpaySubId: "sub_1" });
    expect(subscriptionRenews(f)).toBe(true);
    expect(subscribeDecision(f, "STARTER", NOW)).toEqual({ ok: false, reason: "already_on_plan" });
  });
});

describe("paying, subscription not renewing", () => {
  const CANCELLED_AT_END = {
    planExpiresAt: LATER,
    razorpaySubId: "sub_1",
    razorpaySubStatus: "active",
    razorpaySubCancelAtEnd: true,
  };

  it("the reported dead end: Starter at the store's own price, cancelled at cycle end", () => {
    const f = facts({ access: PAID_STARTER, customPricePaise: 29_900, ...CANCELLED_AT_END });
    expect(offered(f)).toEqual(["STARTER:resubscribe:period_end"]);
  });

  it("list price: same or lower waits for the period's end, higher starts today", () => {
    const f = facts({ access: PAID_STARTER, ...CANCELLED_AT_END });
    expect(offered(f)).toEqual(["LITE:resubscribe:period_end", "STARTER:resubscribe:period_end", "PRO:resubscribe:now"]);
  });

  it("Pro, cancelled, is no longer stuck", () => {
    const f = facts({ access: PAID_PRO, ...CANCELLED_AT_END });
    expect(offered(f)).toEqual([
      "LITE:resubscribe:period_end",
      "STARTER:resubscribe:period_end",
      "PRO:resubscribe:period_end",
    ]);
  });

  for (const status of NOT_LIVE) {
    it(`${status}, inside the paid period: resubscribe from its end`, () => {
      const f = facts({ access: PAID_STARTER, planExpiresAt: LATER, razorpaySubStatus: status });
      expect(subscribeDecision(f, "STARTER", NOW)).toEqual({ ok: true, action: "resubscribe", start: "period_end" });
    });

    it(`${status}, in the grace days: resubscribe starts today`, () => {
      const f = facts({ access: PAID_STARTER, planExpiresAt: EARLIER, razorpaySubStatus: status });
      expect(subscribeDecision(f, "STARTER", NOW)).toEqual({ ok: true, action: "resubscribe", start: "now" });
    });
  }

  it("a paid plan with no subscription on file subscribes rather than resubscribes", () => {
    const f = facts({ access: PAID_LITE, planExpiresAt: LATER });
    expect(offered(f)).toEqual(["LITE:subscribe:period_end", "STARTER:subscribe:now", "PRO:subscribe:now"]);
  });

  it("a plan given by hand with no end date has no lower or same plan to follow it", () => {
    const f = facts({ access: PAID_STARTER, planExpiresAt: null });
    expect(offered(f)).toEqual(["PRO:subscribe:now"]);
    expect(subscribeDecision(f, "STARTER", NOW)).toEqual({ ok: false, reason: "already_on_plan" });
  });
});

describe("a store's own price is for Starter alone", () => {
  it("offers only Starter when not paying", () => {
    expect(offered(facts({ customPricePaise: 29_900 }))).toEqual(["STARTER:subscribe:now"]);
  });

  it("refuses the other plans whatever the state", () => {
    const f = facts({ access: PAID_LITE, planExpiresAt: LATER, customPricePaise: 29_900 });
    expect(subscribeDecision(f, "PRO", NOW)).toEqual({ ok: false, reason: "own_price_starter_only" });
  });
});

describe("carrying the pick from /pricing", () => {
  it("reads the link it builds", () => {
    const url = new URL(billingSelectionPath("STARTER", "yearly"), "http://x");
    expect(url.pathname).toBe("/settings/billing");
    expect(url.search).toBe("?plan=starter&interval=yearly");
    expect(parseBillingSelection(Object.fromEntries(url.searchParams))).toEqual({
      plan: "STARTER",
      interval: "yearly",
    });
  });

  it("ignores anything it doesn't know", () => {
    expect(parseBillingSelection({ plan: "FREE", interval: "weekly" })).toEqual({ plan: null, interval: null });
    expect(parseBillingSelection({ plan: ["lite"], interval: 3 })).toEqual({ plan: null, interval: null });
    expect(parseBillingSelection({})).toEqual({ plan: null, interval: null });
  });

  it("preselects what was asked for, else Starter, else the cheapest", () => {
    const all = plansOnOffer(facts({}), NOW);
    expect(preselectedPlan(all, "PRO")).toBe("PRO");
    expect(preselectedPlan(all, null)).toBe("STARTER");
    const higher = plansOnOffer(facts({ access: PAID_STARTER, razorpaySubStatus: "active" }), NOW);
    expect(preselectedPlan(higher, "LITE")).toBe("PRO");
    expect(preselectedPlan([], "PRO")).toBeNull();
  });
});
