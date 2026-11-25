import { describe, expect, it } from "vitest";

import {
  dropWithinCategory,
  flattenMenuSections,
  groupMenuRows,
  menuCategories,
  menuCategoryOf,
  moveWithinCategory,
} from "@/lib/menu-category";

// As the page loads them: category A–Z, then sortOrder.
const rows = [
  { id: "a1", category: "Drinks" },
  { id: "a2", category: "Drinks" },
  { id: "b1", category: "Snacks" },
  { id: "b2", category: "Snacks" },
  { id: "b3", category: "Snacks" },
];

const ids = (list: { id: string }[] | null) => list?.map((r) => r.id) ?? null;

describe("menu sections", () => {
  it("groups in the order rows arrive, without re-sorting", () => {
    const sections = groupMenuRows(rows);
    expect(sections.map((s) => s.category)).toEqual(["Drinks", "Snacks"]);
    expect(sections[1].items.map((r) => r.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("keeps a category together even when its rows are apart", () => {
    const mixed = [rows[0], rows[2], rows[1]];
    expect(ids(flattenMenuSections(groupMenuRows(mixed)))).toEqual(["a1", "a2", "b1"]);
  });

  it("reads a blank category as General", () => {
    expect(menuCategoryOf({ category: "  " })).toBe("General");
    expect(menuCategoryOf({ category: null })).toBe("General");
    expect(menuCategoryOf({ category: "Rings" })).toBe("Rings");
    // The rename list still leaves blanks out.
    expect(menuCategories([{ category: " " }, { category: "Rings" }])).toEqual(["Rings"]);
  });
});

describe("moving inside a section", () => {
  it("swaps with the neighbour in the same section", () => {
    expect(ids(moveWithinCategory(rows, "b2", "up"))).toEqual(["a1", "a2", "b2", "b1", "b3"]);
    expect(ids(moveWithinCategory(rows, "a1", "down"))).toEqual(["a2", "a1", "b1", "b2", "b3"]);
  });

  it("stops at the edge of the section, not of the list", () => {
    expect(moveWithinCategory(rows, "b1", "up")).toBeNull();
    expect(moveWithinCategory(rows, "a2", "down")).toBeNull();
    expect(moveWithinCategory(rows, "nope", "up")).toBeNull();
  });

  it("drops onto a card in the same section only", () => {
    expect(ids(dropWithinCategory(rows, "b3", "b1"))).toEqual(["a1", "a2", "b3", "b1", "b2"]);
    expect(ids(dropWithinCategory(rows, "b1", "b3"))).toEqual(["a1", "a2", "b2", "b3", "b1"]);
    expect(dropWithinCategory(rows, "a1", "b1")).toBeNull();
    expect(dropWithinCategory(rows, "a1", "a1")).toBeNull();
  });
});
