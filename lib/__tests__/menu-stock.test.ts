import { describe, expect, it } from "vitest";

import { MAX_STOCK_QTY } from "@/lib/inventory";
import { prepareMenuItemCreate } from "@/lib/menu-create";
import {
  adjustDelta,
  adjustedCount,
  hasStockFields,
  menuStockFieldsSchema,
  parseStockInput,
  splitStockFields,
  stockChangeSchema,
} from "@/lib/menu-stock";

describe("menuStockFieldsSchema", () => {
  it("takes a whole count, null to stop tracking, or nothing", () => {
    expect(menuStockFieldsSchema.parse({ stockQty: 12, lowStockAt: 3 })).toEqual({ stockQty: 12, lowStockAt: 3 });
    expect(menuStockFieldsSchema.parse({ stockQty: null, lowStockAt: null })).toEqual({ stockQty: null, lowStockAt: null });
    expect(menuStockFieldsSchema.parse({})).toEqual({});
  });

  it("refuses fractions, negatives, too large and other keys", () => {
    expect(menuStockFieldsSchema.safeParse({ stockQty: 1.5 }).success).toBe(false);
    expect(menuStockFieldsSchema.safeParse({ stockQty: -1 }).success).toBe(false);
    expect(menuStockFieldsSchema.safeParse({ stockQty: MAX_STOCK_QTY + 1 }).success).toBe(false);
    expect(menuStockFieldsSchema.safeParse({ lowStockAt: "3" }).success).toBe(false);
    expect(menuStockFieldsSchema.safeParse({ stockLeft: 3 }).success).toBe(false);
  });

  it("hasStockFields is true once either key is present, null included", () => {
    expect(hasStockFields({})).toBe(false);
    expect(hasStockFields({ stockQty: null })).toBe(true);
    expect(hasStockFields({ lowStockAt: 0 })).toBe(true);
  });
});

describe("splitStockFields", () => {
  it("moves the stock keys out and leaves the rest", () => {
    expect(splitStockFields({ name: "Tee", stockQty: 4, lowStockAt: null })).toEqual({
      stock: { stockQty: 4, lowStockAt: null },
      rest: { name: "Tee" },
    });
  });

  it("passes a non-object through for its schema to refuse", () => {
    expect(splitStockFields(null)).toEqual({ stock: {}, rest: null });
    expect(splitStockFields([1])).toEqual({ stock: {}, rest: [1] });
  });
});

describe("stockChangeSchema", () => {
  it("takes set or adjust, not both", () => {
    expect(stockChangeSchema.parse({ set: 0 })).toEqual({ set: 0 });
    expect(stockChangeSchema.parse({ adjust: -1 })).toEqual({ adjust: -1 });
    expect(stockChangeSchema.parse({ adjust: 5 })).toEqual({ adjust: 5 });
    expect(stockChangeSchema.safeParse({ set: 1, adjust: 1 }).success).toBe(false);
    expect(stockChangeSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a zero, fractional or out-of-range change", () => {
    expect(stockChangeSchema.safeParse({ adjust: 0 }).success).toBe(false);
    expect(stockChangeSchema.safeParse({ adjust: 0.5 }).success).toBe(false);
    expect(stockChangeSchema.safeParse({ set: -2 }).success).toBe(false);
    expect(stockChangeSchema.safeParse({ set: MAX_STOCK_QTY + 1 }).success).toBe(false);
  });
});

describe("adjustedCount", () => {
  it("adds the change to what is left", () => {
    expect(adjustedCount(4, 5)).toBe(9);
    expect(adjustedCount(4, -1)).toBe(3);
  });

  it("starts from what is left when oversold, and never goes below 0 or above the cap", () => {
    expect(adjustedCount(-2, 5)).toBe(3);
    expect(adjustedCount(-2, 1)).toBe(-1);
    expect(adjustedCount(-2, -1)).toBe(-2);
    expect(adjustedCount(0, -1)).toBe(0);
    expect(adjustedCount(1, -3)).toBe(0);
    expect(adjustedCount(MAX_STOCK_QTY, 1)).toBe(MAX_STOCK_QTY);
  });
});

describe("adjustDelta", () => {
  it("is the change to the count, so left lands on adjustedCount", () => {
    expect(adjustDelta(4, 5)).toBe(5);
    expect(adjustDelta(4, -1)).toBe(-1);
  });

  it("never lifts an oversold item on a decrease, and stops at 0 going down", () => {
    expect(adjustDelta(-2, 5)).toBe(5);
    expect(adjustDelta(-2, -1)).toBe(0);
    expect(adjustDelta(0, -1)).toBe(0);
    expect(adjustDelta(1, -3)).toBe(-1);
  });
});

describe("parseStockInput", () => {
  it("reads whole numbers and blank", () => {
    expect(parseStockInput(" 12 ")).toEqual({ value: 12 });
    expect(parseStockInput("0")).toEqual({ value: 0 });
    expect(parseStockInput("")).toEqual({ value: null });
  });

  it("refuses anything else", () => {
    expect(parseStockInput("1.5")).toHaveProperty("error");
    expect(parseStockInput("-3")).toHaveProperty("error");
    expect(parseStockInput("ten")).toHaveProperty("error");
    expect(parseStockInput(String(MAX_STOCK_QTY + 1))).toHaveProperty("error");
  });
});

describe("prepareMenuItemCreate stock", () => {
  const base = {
    name: "Cotton Tee",
    priceInPaise: 49_900,
    aliases: [],
    tags: [],
    emoji: "👕",
    category: "Tops",
    hsnCode: null,
    isPopular: false,
    isAvailable: true,
    showOnline: true,
  };
  const now = new Date("2026-11-10T06:30:00.000Z");

  it("leaves a new item untracked by default", () => {
    const data = prepareMenuItemCreate({ slugs: new Set(), nextSortOrder: 0 }, "v1", base, now);
    expect(data).toMatchObject({ stockQty: null, stockCountedAt: null, lowStockAt: null });
  });

  it("records the first count at creation", () => {
    const data = prepareMenuItemCreate(
      { slugs: new Set(), nextSortOrder: 0 },
      "v1",
      { ...base, stockQty: 10, lowStockAt: 2 },
      now,
    );
    expect(data).toMatchObject({ stockQty: 10, stockCountedAt: now, lowStockAt: 2 });
  });
});
