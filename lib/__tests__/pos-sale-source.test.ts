import { describe, expect, it } from "vitest";

import { counterSaleSource } from "@/lib/pos-sale-source";

describe("counterSaleSource", () => {
  const lines = [{ menuItemId: "a" }, { menuItemId: "b" }];

  it("is MANUAL with no voice-added ids", () => {
    expect(counterSaleSource(lines, [])).toBe("MANUAL");
  });

  it("is VOICE when any cart line was added by voice", () => {
    expect(counterSaleSource(lines, ["b"])).toBe("VOICE");
  });

  it("is MANUAL when the voice-added ids are no longer in the cart", () => {
    expect(counterSaleSource(lines, ["c"])).toBe("MANUAL");
  });

  it("ignores lines without a menu item id", () => {
    expect(counterSaleSource([{}], ["a"])).toBe("MANUAL");
    expect(counterSaleSource([{}, { menuItemId: "a" }], ["a"])).toBe("VOICE");
  });

  it("is MANUAL for an empty cart", () => {
    expect(counterSaleSource([], ["a"])).toBe("MANUAL");
  });
});
