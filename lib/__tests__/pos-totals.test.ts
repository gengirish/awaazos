import { describe, expect, it } from "vitest";

import type { CartLine } from "@/lib/cartStore";
import { computeCartTotals } from "@/lib/pos-totals";

const line = (id: string, priceInPaise: number, qty: number): CartLine => ({
  menuItemId: id,
  name: id,
  emoji: "🍽️",
  priceInPaise,
  qty,
});

describe("computeCartTotals", () => {
  it("sums lines and counts quantities", () => {
    expect(computeCartTotals([line("a", 2000, 2), line("b", 1500, 1)], { taxEnabled: false, taxPercent: "5" })).toEqual({
      subtotalPaise: 5500,
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
      taxPaise: 0,
      totalPaise: 0,
      itemCount: 0,
    });
  });
});
