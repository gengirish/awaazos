import { describe, expect, it } from "vitest";

import { rupeesToPaise } from "@/lib/currency";
import {
  MENU_DESCRIPTION_MAX,
  menuItemCreateInputSchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  normaliseMenuDescription,
  parseAliasesCsv,
} from "@/lib/zod-menu";

describe("parseAliasesCsv", () => {
  it("parses comma-separated values with trim", () => {
    expect(parseAliasesCsv("bhel, lays bhel , ")).toEqual(["bhel", "lays bhel"]);
  });

  it("returns empty for empty or whitespace", () => {
    expect(parseAliasesCsv(undefined)).toEqual([]);
    expect(parseAliasesCsv("")).toEqual([]);
    expect(parseAliasesCsv("  ")).toEqual([]);
  });
});

describe("menuItemCreateSchema", () => {
  it("requires name", () => {
    expect(() =>
      menuItemCreateSchema.parse({
        priceInRupees: 10,
      } as never),
    ).toThrow();
  });

  it("enforces priceInRupees > 0", () => {
    expect(() =>
      menuItemCreateSchema.parse({
        name: "Samosa",
        priceInRupees: 0,
      }),
    ).toThrow();
  });

  it("converts ₹19.50 to 1950 paise", () => {
    const out = menuItemCreateSchema.parse({ name: "Chai", priceInRupees: 19.5 });
    expect(out.priceInPaise).toBe(1950);
  });

  it("converts ₹0.99 to 99 paise", () => {
    const out = menuItemCreateSchema.parse({ name: "Candy", priceInRupees: 0.99 });
    expect(out.priceInPaise).toBe(99);
  });

  it("applies aliases CSV parsing in transform", () => {
    const out = menuItemCreateSchema.parse({
      name: "Bhel",
      priceInRupees: 40,
      aliasesCsv: "bhel puri, spicy bhel",
    });
    expect(out.aliases).toEqual(["bhel puri", "spicy bhel"]);
  });

  it("normalizes optional HSN/SAC to uppercase and trims it", () => {
    const out = menuItemCreateSchema.parse({
      name: "Masala Chai",
      priceInRupees: 15,
      hsnCode: " 9963 ",
    });
    expect(out.hsnCode).toBe("9963");
  });
});

describe("menuItemCreateInputSchema + rupeesToPaise", () => {
  it("matches documented paise conversion for edge inputs", () => {
    const parsed = menuItemCreateInputSchema.parse({ name: "x", priceInRupees: 19.5 });
    expect(rupeesToPaise(parsed.priceInRupees)).toBe(1950);
    const p2 = menuItemCreateInputSchema.parse({ name: "x", priceInRupees: 0.99 });
    expect(rupeesToPaise(p2.priceInRupees)).toBe(99);
  });
});

describe("menuItemUpdateSchema — showOnline", () => {
  it("accepts a showOnline-only update (the Menu page switch sends just that)", () => {
    expect(menuItemUpdateSchema.safeParse({ showOnline: false }).success).toBe(true);
  });

  it("still rejects an empty update", () => {
    expect(menuItemUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("defaults showOnline to true on create", () => {
    expect(menuItemCreateSchema.parse({ name: "Chai", priceInRupees: 10 }).showOnline).toBe(true);
  });
});

describe("menu item description", () => {
  it("normalises whitespace and newlines, blank is none", () => {
    expect(normaliseMenuDescription("  8 mm Karungali beads,\n108 count  ")).toBe("8 mm Karungali beads, 108 count");
    expect(normaliseMenuDescription("   ")).toBeNull();
    expect(normaliseMenuDescription(undefined)).toBeNull();
    expect(normaliseMenuDescription(null)).toBeNull();
  });

  it("create: optional, normalised, capped", () => {
    expect(menuItemCreateSchema.parse({ name: "Mala", priceInRupees: 799 }).description).toBeNull();
    expect(
      menuItemCreateSchema.parse({ name: "Mala", priceInRupees: 799, description: " 108 beads " }).description,
    ).toBe("108 beads");
    expect(() =>
      menuItemCreateSchema.parse({ name: "Mala", priceInRupees: 799, description: "x".repeat(MENU_DESCRIPTION_MAX + 1) }),
    ).toThrow();
  });

  it("update: on its own is a change; null and blank both reach the route to clear it", () => {
    expect(menuItemUpdateSchema.parse({ description: "108 beads" }).description).toBe("108 beads");
    expect(menuItemUpdateSchema.parse({ description: null }).description).toBeNull();
    expect(menuItemUpdateSchema.parse({ description: "" }).description).toBe("");
    expect(() => menuItemUpdateSchema.parse({ description: "x".repeat(MENU_DESCRIPTION_MAX + 1) })).toThrow();
  });
});
