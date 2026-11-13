import { describe, expect, it } from "vitest";

import { MAX_STOCK_QTY } from "@/lib/inventory";
import { MAX_PURCHASE_LINES, purchaseLine, purchaseTotalPaise } from "@/lib/stock-purchase";
import { receiveStockSchema } from "@/lib/stock-purchase-schema";

describe("stock purchases: the request", () => {
  it("takes one line for an item, or one per size, with an optional cost", () => {
    expect(receiveStockSchema.safeParse({ lines: [{ qty: 10 }] }).success).toBe(true);
    expect(
      receiveStockSchema.safeParse({
        lines: [
          { variantId: "m", qty: 4 },
          { variantId: "l", qty: 6 },
        ],
        costInRupees: 450.5,
      }).success,
    ).toBe(true);
    // null = keep the cost on record, like leaving the field blank.
    expect(receiveStockSchema.safeParse({ lines: [{ qty: 1 }], costInRupees: null }).success).toBe(true);
    expect(receiveStockSchema.safeParse({ lines: [{ qty: 1 }], costInRupees: 0 }).success).toBe(true);
  });

  it("refuses nothing received, bad quantities and bad costs", () => {
    const bad = [
      { lines: [] },
      { lines: [{ qty: 0 }] },
      { lines: [{ qty: -2 }] },
      { lines: [{ qty: 1.5 }] },
      { lines: [{ qty: "3" }] },
      { lines: [{ qty: MAX_STOCK_QTY + 1 }] },
      { lines: [{ qty: 1 }], costInRupees: -1 },
      { lines: [{ qty: 1 }], costInRupees: 1.234 },
      { lines: [{ qty: 1 }], costInRupees: 100000.01 },
      { lines: [{ qty: 1 }], costInPaise: 100 },
      { lines: [{ qty: 1, set: 4 }] },
      {},
    ];
    for (const body of bad) {
      expect(receiveStockSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("takes each size once, and at most MAX_PURCHASE_LINES of them", () => {
    expect(
      receiveStockSchema.safeParse({
        lines: [
          { variantId: "m", qty: 1 },
          { variantId: "m", qty: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(receiveStockSchema.safeParse({ lines: [{ qty: 1 }, { qty: 2 }] }).success).toBe(false);
    const many = Array.from({ length: MAX_PURCHASE_LINES + 1 }, (_, i) => ({ variantId: `v${i}`, qty: 1 }));
    expect(receiveStockSchema.safeParse({ lines: many }).success).toBe(false);
    expect(receiveStockSchema.safeParse({ lines: many.slice(1) }).success).toBe(true);
  });
});

describe("stock purchases: what the seller reads", () => {
  it("totals a delivery in paise, or says nothing without a cost", () => {
    expect(purchaseTotalPaise(10, 45050)).toBe(450500);
    expect(purchaseTotalPaise(3, 0)).toBe(0);
    expect(purchaseTotalPaise(10, null)).toBeNull();
  });

  it("writes one line per purchase with the IST date", () => {
    expect(
      purchaseLine({
        id: "p1",
        variantLabel: "M",
        qty: 10,
        unitCostInPaise: 45000,
        // 19:30 UTC is already the next day in India.
        purchasedAt: "2026-11-12T19:30:00.000Z",
      }),
    ).toBe("13/11/2026 · M · 10 received · ₹450.00 each");
    expect(
      purchaseLine({ id: "p2", variantLabel: null, qty: 2, unitCostInPaise: null, purchasedAt: "2026-11-12T06:00:00.000Z" }),
    ).toBe("12/11/2026 · 2 received · cost not recorded");
  });
});
