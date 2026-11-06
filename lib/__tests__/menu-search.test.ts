import { describe, expect, it } from "vitest";

import { isMenuFilterEmpty, menuItemMatches } from "@/lib/menu-search";
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
