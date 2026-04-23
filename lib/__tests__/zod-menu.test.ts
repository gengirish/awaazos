import { describe, expect, it } from "vitest";

import { rupeesToPaise } from "@/lib/currency";
import {
  menuItemCreateInputSchema,
  menuItemCreateSchema,
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
});

describe("menuItemCreateInputSchema + rupeesToPaise", () => {
  it("matches documented paise conversion for edge inputs", () => {
    const parsed = menuItemCreateInputSchema.parse({ name: "x", priceInRupees: 19.5 });
    expect(rupeesToPaise(parsed.priceInRupees)).toBe(1950);
    const p2 = menuItemCreateInputSchema.parse({ name: "x", priceInRupees: 0.99 });
    expect(rupeesToPaise(p2.priceInRupees)).toBe(99);
  });
});
