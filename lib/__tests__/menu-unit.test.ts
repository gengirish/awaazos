import { describe, expect, it } from "vitest";

import { isValidMenuUnit, MENU_UNIT_MAX, menuUnitSchema, normaliseMenuUnit } from "@/lib/menu-unit";
import { menuBulkBodySchema, menuItemCreateSchema, menuItemUpdateSchema } from "@/lib/zod-menu";

describe("normaliseMenuUnit", () => {
  it("trims, collapses spaces and turns blank into null", () => {
    expect(normaliseMenuUnit("  100   g ")).toBe("100 g");
    expect(normaliseMenuUnit("   ")).toBeNull();
    expect(normaliseMenuUnit(null)).toBeNull();
    expect(normaliseMenuUnit(undefined)).toBeNull();
  });
});

describe("isValidMenuUnit", () => {
  it("accepts kitchen units and pack sizes", () => {
    for (const u of ["kg", "piece", "box", "100 g", "60 capsules", "500 ml", "1.5 kg", "2 x 250 g", "pack of 6"]) {
      expect(isValidMenuUnit(u)).toBe(true);
    }
  });

  it("rejects symbols, a leading punctuation mark and long text", () => {
    expect(isValidMenuUnit("<b>")).toBe(false);
    expect(isValidMenuUnit("-kg")).toBe(false);
    expect(isValidMenuUnit("a".repeat(MENU_UNIT_MAX + 1))).toBe(false);
  });
});

describe("menuUnitSchema", () => {
  it("normalises and clears", () => {
    expect(menuUnitSchema.parse(" 250  g ")).toBe("250 g");
    expect(menuUnitSchema.parse("")).toBeNull();
    expect(menuUnitSchema.parse(null)).toBeNull();
    expect(menuUnitSchema.safeParse("₹₹").success).toBe(false);
  });
});

describe("menu schemas carry unit", () => {
  it("create defaults to null and keeps a given size", () => {
    expect(menuItemCreateSchema.parse({ name: "Chai", priceInRupees: 10 }).unit).toBeNull();
    expect(menuItemCreateSchema.parse({ name: "Ghee", priceInRupees: 650, unit: "500 ml" }).unit).toBe("500 ml");
  });

  it("update accepts unit alone, and null clears it", () => {
    expect(menuItemUpdateSchema.parse({ unit: "100 g" })).toEqual({ unit: "100 g" });
    expect(menuItemUpdateSchema.parse({ unit: "" })).toEqual({ unit: null });
  });

  it("bulk rows take an optional unit", () => {
    const out = menuBulkBodySchema.parse({ items: [{ name: "Tulsi Tea", priceInPaise: 19900, unit: "100 g" }, { name: "Samosa", priceInPaise: 2000 }] });
    expect(out.items.map((i) => i.unit)).toEqual(["100 g", undefined]);
  });
});
