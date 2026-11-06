import { describe, expect, it } from "vitest";

import { itemSearchText, matchesSearch, normaliseSearchText, searchTerms } from "@/lib/store-search";

describe("store search", () => {
  it("normalises case, accents and punctuation", () => {
    expect(normaliseSearchText("  Café  Crème-Brûlée (1 kg)! ")).toBe("cafe creme brulee 1 kg");
  });

  it("needs every word, in any order", () => {
    const terms = searchTerms("cake choc");
    expect(matchesSearch("Chocolate Truffle Cake", terms)).toBe(true);
    expect(matchesSearch("Chocolate Cookies", terms)).toBe(false);
  });

  it("matches the category as part of the item's text", () => {
    expect(matchesSearch("Ragi Laddu Sweets", searchTerms("sweet"))).toBe(true);
  });

  it("matches everything for a blank or punctuation-only query", () => {
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("—!")).toEqual([]);
    expect(matchesSearch("anything", searchTerms(""))).toBe(true);
  });

  it("keeps non-Latin scripts", () => {
    expect(matchesSearch("मसाला चाय", searchTerms("चाय"))).toBe(true);
  });
});

describe("itemSearchText", () => {
  it("matches the description and the context", () => {
    const text = itemSearchText({ name: "Ragi Laddu", description: "No sugar, made with jaggery" }, "Sweets");
    expect(matchesSearch(text, searchTerms("jaggery"))).toBe(true);
    expect(matchesSearch(text, searchTerms("sweet laddu"))).toBe(true);
  });

  it("matches aliases when given", () => {
    const text = itemSearchText({ name: "Bhel Puri", aliases: ["bhel", "lays bhel"] }, "Chaat");
    expect(matchesSearch(text, searchTerms("lays"))).toBe(true);
    expect(matchesSearch(itemSearchText({ name: "Bhel Puri" }, "Chaat"), searchTerms("lays"))).toBe(false);
  });

  it("skips missing parts", () => {
    expect(itemSearchText({ name: "Samosa", description: null, aliases: null }, null, "Snacks")).toBe("Samosa Snacks");
  });
});
