import { describe, expect, it } from "vitest";

import { maxOrderableQty, orderErrorMessage, restoreCartLines } from "@/lib/storefront-order";
import {
  cartAfterStockRejection,
  dropItemStock,
  stockBadgeText,
  storefrontStock,
  withStockOverride,
} from "@/lib/storefront-stock";

describe("storefrontStock", () => {
  it("is null for an untracked item", () => {
    expect(storefrontStock(null, null)).toBeNull();
  });

  it("hides the count above the low-stock line", () => {
    expect(storefrontStock(12, null)).toEqual({ soldOut: false, onlyLeft: null, maxQty: 12 });
    expect(storefrontStock(12, 5)).toEqual({ soldOut: false, onlyLeft: null, maxQty: 12 });
  });

  it("says Only N left at or below the line (default 3)", () => {
    expect(storefrontStock(3, null)).toEqual({ soldOut: false, onlyLeft: 3, maxQty: 3 });
    expect(storefrontStock(5, 5)).toEqual({ soldOut: false, onlyLeft: 5, maxQty: 5 });
  });

  it("is sold out at zero or oversold", () => {
    expect(storefrontStock(0, null)).toEqual({ soldOut: true, onlyLeft: null, maxQty: 0 });
    expect(storefrontStock(-2, null)).toEqual({ soldOut: true, onlyLeft: null, maxQty: 0 });
  });
});

describe("dropItemStock", () => {
  it("leaves an untracked product to the drop's cap", () => {
    expect(dropItemStock(4, null, null)).toEqual({ remaining: 4 });
    expect(dropItemStock(null, null, null)).toEqual({ remaining: null });
  });

  it("keeps the drop's badge when the drop's cap binds", () => {
    expect(dropItemStock(4, 10, null)).toEqual({ remaining: 4 });
    expect(dropItemStock(4, 4, null)).toEqual({ remaining: 4 });
  });

  it("caps by stock and follows the low-stock line when stock binds", () => {
    expect(dropItemStock(20, 8, null)).toEqual({ remaining: 8, onlyLeft: null });
    expect(dropItemStock(null, 2, null)).toEqual({ remaining: 2, onlyLeft: 2 });
    expect(dropItemStock(null, 6, 6)).toEqual({ remaining: 6, onlyLeft: 6 });
    expect(dropItemStock(5, -1, null)).toEqual({ remaining: 0, onlyLeft: null });
  });
});

describe("stockBadgeText", () => {
  it("names the state in words", () => {
    expect(stockBadgeText(null)).toBeNull();
    expect(stockBadgeText({ soldOut: true, onlyLeft: null })).toBe("Sold out");
    expect(stockBadgeText({ soldOut: false, onlyLeft: 2 })).toBe("Only 2 left");
    expect(stockBadgeText({ soldOut: false, onlyLeft: null })).toBeNull();
  });
});

describe("withStockOverride", () => {
  it("keeps the page's stock without an override", () => {
    const s = storefrontStock(9, null);
    expect(withStockOverride(s, undefined)).toBe(s);
  });

  it("takes the server's remaining, never above the page's", () => {
    expect(withStockOverride(storefrontStock(9, null), 2)).toEqual({ soldOut: false, onlyLeft: 2, maxQty: 2 });
    expect(withStockOverride(storefrontStock(1, null), 5)).toEqual({ soldOut: false, onlyLeft: 1, maxQty: 1 });
    expect(withStockOverride(null, 0)).toEqual({ soldOut: true, onlyLeft: null, maxQty: 0 });
  });
});

describe("cartAfterStockRejection", () => {
  it("cuts the line down to what is left", () => {
    expect(cartAfterStockRejection({ a: 5, b: 1 }, "a", 2)).toEqual({ a: 2, b: 1 });
  });

  it("removes a sold-out line", () => {
    expect(cartAfterStockRejection({ a: 5, b: 1 }, "a", 0)).toEqual({ b: 1 });
    expect(cartAfterStockRejection({ a: 5 }, "a", -3)).toEqual({});
  });

  it("leaves a smaller line and other items alone", () => {
    const cart = { a: 1 };
    expect(cartAfterStockRejection(cart, "a", 4)).toEqual({ a: 1 });
    expect(cartAfterStockRejection(cart, "gift", 0)).toEqual({ a: 1 });
    expect(cart).toEqual({ a: 1 });
  });
});

describe("saved cart clamps to stock on load", () => {
  it("cuts tracked lines to maxQty and drops sold-out ones", () => {
    const stock: Record<string, number | null> = { tracked: 2, gone: 0, free: null };
    const maxFor = (id: string) => (id in stock ? maxOrderableQty(stock[id] ?? null, null) : null);
    expect(restoreCartLines({ tracked: 5, gone: 1, free: 3, unknown: 1 }, maxFor)).toEqual({ tracked: 2, free: 3 });
  });
});

describe("orderErrorMessage out_of_stock", () => {
  it("names the item and how many are left", () => {
    expect(orderErrorMessage({ error: "out_of_stock", menuItemId: "m", remaining: 2 }, "Kurta")).toBe(
      "Kurta: only 2 left now. We've updated your cart — please check and try again.",
    );
    expect(orderErrorMessage({ error: "out_of_stock", menuItemId: "m", remaining: 0 }, "Kurta")).toBe(
      "Kurta just sold out. We've removed it from your cart.",
    );
  });
});
