import { describe, expect, it } from "vitest";

import { STALL_TYPES } from "@/lib/constants";
import { countItems, fillVocabulary, storeKind, storeVocabulary } from "@/lib/store-vocabulary";

describe("storeKind", () => {
  it("keeps kitchens, and the GENERAL default, on the food words", () => {
    for (const t of ["GENERAL", "HOME_KITCHEN", "HOME_BAKERY", "CLOUD_KITCHEN", "SWEETS", "CAFE", "CATERING"] as const) {
      expect(storeKind(t)).toBe("food");
    }
    expect(storeKind(null)).toBe("food");
  });

  it("puts every store that isn't clearly food on the neutral words", () => {
    for (const t of ["OTHER", "KIRANA", "CLOTHING", "SERVICES", "EVENT_POPUP"] as const) {
      expect(storeKind(t)).toBe("goods");
    }
  });

  it("classifies every listed store type", () => {
    for (const { value } of STALL_TYPES) expect(["food", "goods"]).toContain(storeKind(value));
  });
});

describe("storeVocabulary", () => {
  it("names the catalogue for each kind", () => {
    expect(storeVocabulary("HOME_KITCHEN")).toMatchObject({ catalogueTitle: "Menu", item: "dish", prepSheet: "Prep sheet" });
    expect(storeVocabulary("OTHER")).toMatchObject({ catalogueTitle: "Products", item: "product", prepSheet: "Packing list", foodArt: false });
  });
});

describe("fillVocabulary", () => {
  it("fills known tokens and leaves unknown ones visible", () => {
    const goods = storeVocabulary("OTHER");
    expect(fillVocabulary("Add your first {item} to the {catalogue}", goods)).toBe("Add your first product to the product list");
    expect(fillVocabulary("{Items} and {nope} and {foodArt}", goods)).toBe("Products and {nope} and {foodArt}");
  });
});

describe("countItems", () => {
  it("pluralises", () => {
    expect(countItems(storeVocabulary("HOME_KITCHEN"), 1)).toBe("1 dish");
    expect(countItems(storeVocabulary("OTHER"), 3)).toBe("3 products");
  });
});
