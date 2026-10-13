import { describe, expect, it } from "vitest";

import type { CartLine } from "@/lib/cartStore";
import type { ResolvedOffer } from "@/lib/offers";
import { computeCartTotals, toPayTotals } from "@/lib/pos-totals";

const line = (id: string, priceInPaise: number, qty: number): CartLine => ({
  menuItemId: id,
  name: id,
  emoji: "🍽️",
  priceInPaise,
  qty,
});

const NO_OFFER = { discountPaise: 0, offer: null, nudge: null };

const WEEKLY: ResolvedOffer = {
  id: "weekly",
  name: "Weekly Plan",
  description: null,
  minQty: 4,
  percentBps: 1000,
  eligibleItemIds: ["quiche", "paneer-quiche"],
  eligibleLabel: "quiche",
  requiredItemIds: ["paneer-quiche"],
  requiredQty: 1,
  requiredLabel: "paneer",
};

describe("computeCartTotals", () => {
  it("sums lines and counts quantities", () => {
    expect(computeCartTotals([line("a", 2000, 2), line("b", 1500, 1)], { taxEnabled: false, taxPercent: "5" })).toEqual({
      subtotalPaise: 5500,
      ...NO_OFFER,
      taxPaise: 0,
      totalPaise: 5500,
      itemCount: 3,
    });
  });

  it("floors tax in basis points", () => {
    // 1999 * 250 / 10000 = 49.975 → 49
    expect(computeCartTotals([line("a", 1999, 1)], { taxEnabled: true, taxPercent: "2.5" })).toMatchObject({
      taxPaise: 49,
      totalPaise: 2048,
    });
  });

  it("is zero for an empty cart", () => {
    expect(computeCartTotals([], { taxEnabled: true, taxPercent: "18" })).toEqual({
      subtotalPaise: 0,
      ...NO_OFFER,
      taxPaise: 0,
      totalPaise: 0,
      itemCount: 0,
    });
  });

  it("applies an offer to a cart however it was built, and taxes the discounted value", () => {
    // 3 × ₹60 + 1 × ₹100 quiches = ₹280, plus a ₹40 bhel the plan does not cover.
    const cart = [line("quiche", 6000, 3), line("paneer-quiche", 10000, 1), line("bhel", 4000, 1)];
    const t = computeCartTotals(cart, { taxEnabled: true, taxPercent: "5", offers: [WEEKLY] });
    expect(t.subtotalPaise).toBe(32000);
    expect(t.discountPaise).toBe(2800);
    expect(t.offer).toMatchObject({ offerId: "weekly", name: "Weekly Plan" });
    // 5% of (320 − 28) = ₹14.60, not 5% of ₹320.
    expect(t.taxPaise).toBe(1460);
    expect(t.totalPaise).toBe(32000 - 2800 + 1460);
    expect(toPayTotals(t)).toEqual({
      subtotalPaise: 32000,
      discountPaise: 2800,
      offerId: "weekly",
      offerName: "Weekly Plan",
      taxPaise: 1460,
      totalPaise: 30660,
    });
  });

  it("carries a nudge when the cart is one item short", () => {
    const t = computeCartTotals([line("quiche", 6000, 3)], { taxEnabled: false, taxPercent: "0", offers: [WEEKLY] });
    expect(t.discountPaise).toBe(0);
    expect(t.nudge).toMatchObject({ offerId: "weekly", missingQty: 1, missingRequiredQty: 1 });
  });
});
