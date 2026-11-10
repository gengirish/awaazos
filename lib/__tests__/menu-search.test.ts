import { describe, expect, it } from "vitest";

import {
  isMenuFilterEmpty,
  isMenuItemLowStock,
  isMenuItemSoldOut,
  menuItemMatches,
  menuStatusFilters,
} from "@/lib/menu-search";
import { searchTerms } from "@/lib/store-search";

const chai = { name: "Masala Chai", category: "Drinks", aliases: ["cutting"], isAvailable: true };
const laddu = { name: "Ragi Laddu", description: "Made with jaggery", category: "Sweets", isAvailable: false };

describe("menu filter", () => {
  it("matches name, description, aliases and category", () => {
    expect(menuItemMatches(chai, { terms: searchTerms("cutting"), status: "all" })).toBe(true);
    expect(menuItemMatches(chai, { terms: searchTerms("drink"), status: "all" })).toBe(true);
    expect(menuItemMatches(laddu, { terms: searchTerms("jaggery"), status: "all" })).toBe(true);
    expect(menuItemMatches(laddu, { terms: searchTerms("chai"), status: "all" })).toBe(false);
  });

  it("filters by selling or sold out", () => {
    expect(menuItemMatches(chai, { terms: [], status: "selling" })).toBe(true);
    expect(menuItemMatches(laddu, { terms: [], status: "selling" })).toBe(false);
    expect(menuItemMatches(laddu, { terms: [], status: "sold_out" })).toBe(true);
    expect(menuItemMatches(chai, { terms: [], status: "sold_out" })).toBe(false);
  });

  it("needs both the words and the status", () => {
    expect(menuItemMatches(laddu, { terms: searchTerms("ragi"), status: "selling" })).toBe(false);
  });

  it("is empty only with no words and All", () => {
    expect(isMenuFilterEmpty({ terms: [], status: "all" })).toBe(true);
    expect(isMenuFilterEmpty({ terms: ["x"], status: "all" })).toBe(false);
    expect(isMenuFilterEmpty({ terms: [], status: "sold_out" })).toBe(false);
  });
});

describe("menu filter with stock", () => {
  const tee = { name: "Cotton Tee", category: "Tops", isAvailable: true, stockLeft: 2, lowStockAt: 3 };
  const kurta = { name: "Kurta", category: "Tops", isAvailable: true, stockLeft: 0, lowStockAt: null };
  const scarf = { name: "Scarf", category: "Accessories", isAvailable: true, stockLeft: -1, lowStockAt: null };
  const saree = { name: "Saree", category: "Sarees", isAvailable: true, stockLeft: 12, lowStockAt: 3 };

  it("counts a tracked item with nothing left as sold out, even while Selling is on", () => {
    expect(isMenuItemSoldOut(kurta)).toBe(true);
    expect(isMenuItemSoldOut(scarf)).toBe(true);
    expect(isMenuItemSoldOut(tee)).toBe(false);
    expect(menuItemMatches(kurta, { terms: [], status: "sold_out" })).toBe(true);
    expect(menuItemMatches(kurta, { terms: [], status: "selling" })).toBe(false);
  });

  it("Low stock takes low, sold out and oversold tracked items only", () => {
    expect(isMenuItemLowStock(tee)).toBe(true);
    expect(isMenuItemLowStock(kurta)).toBe(true);
    expect(isMenuItemLowStock(scarf)).toBe(true);
    expect(isMenuItemLowStock(saree)).toBe(false);
    // Untracked, even when switched off: not a stock problem.
    expect(isMenuItemLowStock(laddu)).toBe(false);
    expect(menuItemMatches(chai, { terms: [], status: "low_stock" })).toBe(false);
  });

  it("offers Low stock only once something is tracked", () => {
    expect(menuStatusFilters(false)).toEqual(["all", "selling", "sold_out"]);
    expect(menuStatusFilters(true)).toContain("low_stock");
  });
});
