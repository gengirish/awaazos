import { describe, expect, it } from "vitest";

import {
  BUYER_HINT_DEFAULT,
  MAX_STOCK_QTY,
  buyerMaxQty,
  buyerStock,
  combinedRemaining,
  firstShortfall,
  isValidStockQty,
  stockLabel,
  stockLeft,
  stockState,
} from "@/lib/inventory";

describe("stockLeft", () => {
  it("is null for an untracked item, whatever was sold", () => {
    expect(stockLeft(null, 0)).toBeNull();
    expect(stockLeft(null, 50)).toBeNull();
  });

  it("is the count minus what is held, and may go negative (counter oversell)", () => {
    expect(stockLeft(10, 0)).toBe(10);
    expect(stockLeft(10, 4)).toBe(6);
    expect(stockLeft(10, 10)).toBe(0);
    expect(stockLeft(10, 12)).toBe(-2);
    expect(stockLeft(0, 0)).toBe(0);
  });
});

describe("stockState", () => {
  it("untracked when left is null", () => {
    expect(stockState(null, null)).toBe("untracked");
    expect(stockState(null, 5)).toBe("untracked");
  });

  it("oversold below zero, sold out at zero", () => {
    expect(stockState(-1, null)).toBe("oversold");
    expect(stockState(0, null)).toBe("sold_out");
    expect(stockState(0, 5)).toBe("sold_out");
  });

  it("low at or below the seller's line, only when one is set", () => {
    expect(stockState(2, 2)).toBe("low");
    expect(stockState(1, 2)).toBe("low");
    expect(stockState(3, 2)).toBe("in_stock");
    expect(stockState(1, null)).toBe("in_stock");
  });
});

describe("stockLabel", () => {
  it("labels every state", () => {
    expect(stockLabel(null, null)).toBeNull();
    expect(stockLabel(-3, null)).toBe("Oversold by 3");
    expect(stockLabel(0, 2)).toBe("Sold out");
    expect(stockLabel(2, 2)).toBe("Low: 2 left");
    expect(stockLabel(12, 2)).toBe("12 in stock");
    expect(stockLabel(1, null)).toBe("1 in stock");
  });
});

describe("buyerStock", () => {
  it("says nothing about an untracked item", () => {
    expect(buyerStock(null, null)).toEqual({ soldOut: false, onlyLeft: null });
  });

  it("is sold out at zero or below, never showing a negative number", () => {
    expect(buyerStock(0, null)).toEqual({ soldOut: true, onlyLeft: null });
    expect(buyerStock(-4, 2)).toEqual({ soldOut: true, onlyLeft: null });
  });

  it("shows 'Only N left' at or below the seller's line", () => {
    expect(buyerStock(5, 5)).toEqual({ soldOut: false, onlyLeft: 5 });
    expect(buyerStock(6, 5)).toEqual({ soldOut: false, onlyLeft: null });
  });

  it("falls back to BUYER_HINT_DEFAULT when the seller set no line", () => {
    expect(buyerStock(BUYER_HINT_DEFAULT, null)).toEqual({ soldOut: false, onlyLeft: BUYER_HINT_DEFAULT });
    expect(buyerStock(BUYER_HINT_DEFAULT + 1, null)).toEqual({ soldOut: false, onlyLeft: null });
  });

  it("a line of 0 never hints above zero", () => {
    expect(buyerStock(1, 0)).toEqual({ soldOut: false, onlyLeft: null });
  });
});

describe("buyerMaxQty", () => {
  it("null = no limit; otherwise left, floored at 0", () => {
    expect(buyerMaxQty(null)).toBeNull();
    expect(buyerMaxQty(7)).toBe(7);
    expect(buyerMaxQty(0)).toBe(0);
    expect(buyerMaxQty(-2)).toBe(0);
  });
});

describe("combinedRemaining", () => {
  it("null only when neither the drop nor the product limits it", () => {
    expect(combinedRemaining(null, null)).toBeNull();
  });

  it("takes whichever limit exists", () => {
    expect(combinedRemaining(5, null)).toBe(5);
    expect(combinedRemaining(null, 8)).toBe(8);
  });

  it("the smaller wins", () => {
    expect(combinedRemaining(5, 8)).toBe(5);
    expect(combinedRemaining(9, 3)).toBe(3);
    expect(combinedRemaining(0, 3)).toBe(0);
  });

  it("an oversold product counts as 0, never negative", () => {
    expect(combinedRemaining(null, -2)).toBe(0);
    expect(combinedRemaining(5, -2)).toBe(0);
  });
});

describe("firstShortfall", () => {
  it("passes untracked items (absent from left)", () => {
    expect(firstShortfall(new Map([["a", 99]]), new Map())).toBeNull();
  });

  it("passes when every line fits, including exactly what is left", () => {
    const left = new Map([
      ["a", 3],
      ["b", 1],
    ]);
    expect(
      firstShortfall(
        new Map([
          ["a", 3],
          ["b", 1],
        ]),
        left,
      ),
    ).toBeNull();
  });

  it("returns the first line that needs more than is left", () => {
    const need = new Map([
      ["a", 1],
      ["b", 4],
      ["c", 9],
    ]);
    const left = new Map([
      ["a", 5],
      ["b", 2],
      ["c", 0],
    ]);
    expect(firstShortfall(need, left)).toEqual({ menuItemId: "b", remaining: 2 });
  });

  it("reports an oversold item's remaining as 0", () => {
    expect(firstShortfall(new Map([["a", 1]]), new Map([["a", -3]]))).toEqual({ menuItemId: "a", remaining: 0 });
  });
});

describe("isValidStockQty", () => {
  it("accepts whole numbers from 0 to MAX_STOCK_QTY", () => {
    expect(isValidStockQty(0)).toBe(true);
    expect(isValidStockQty(42)).toBe(true);
    expect(isValidStockQty(MAX_STOCK_QTY)).toBe(true);
  });

  it("rejects negatives, fractions, too large and non-numbers", () => {
    expect(isValidStockQty(-1)).toBe(false);
    expect(isValidStockQty(1.5)).toBe(false);
    expect(isValidStockQty(MAX_STOCK_QTY + 1)).toBe(false);
    expect(isValidStockQty(Number.NaN)).toBe(false);
    expect(isValidStockQty("5")).toBe(false);
    expect(isValidStockQty(null)).toBe(false);
    expect(isValidStockQty(undefined)).toBe(false);
  });
});
