import { describe, expect, it } from "vitest";

import { matchesSearch, normaliseSearchText, searchTerms } from "@/lib/store-search";

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
