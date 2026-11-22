import { describe, expect, it } from "vitest";

import { ON_MENU, deleteItemTitle, dropBlocksArchive, inOpenDropMessage } from "@/lib/menu-archive";
import { menuCategories, MENU_CATEGORY_MAX } from "@/lib/menu-category";
import { menuCategoryRenameSchema } from "@/lib/zod-menu";

describe("menu archive (lib/menu-archive.ts)", () => {
  it("lists only items that are not deleted", () => {
    expect(ON_MENU).toEqual({ archivedAt: null });
  });

  it("refuses a delete while a drop can still sell the item (rule 3)", () => {
    expect(dropBlocksArchive("DRAFT")).toBe(true);
    expect(dropBlocksArchive("SCHEDULED")).toBe(true);
    expect(dropBlocksArchive("OPEN")).toBe(true);
    // An OPEN row past its cut-off reads CLOSED (effectiveDropStatus) and does not block.
    expect(dropBlocksArchive("CLOSED")).toBe(false);
    expect(dropBlocksArchive("FROZEN")).toBe(false);
    expect(dropBlocksArchive("FULFILLED")).toBe(false);
  });

  it("names the pre-orders that still sell it", () => {
    expect(inOpenDropMessage([])).toBe("It is in a pre-order that is still open. Remove it from there first.");
    expect(inOpenDropMessage(["Saturday Bakes"])).toBe(
      "It is in the pre-order “Saturday Bakes”. Remove it from there first.",
    );
    expect(inOpenDropMessage(["A", " ", "B", "C"])).toBe(
      "It is in the pre-orders “A”, “B” and “C”. Remove it from those first.",
    );
  });

  it("asks before deleting", () => {
    expect(deleteItemTitle("Samosa")).toBe("Delete Samosa?");
  });
});

describe("menu categories (lib/menu-category.ts)", () => {
  it("keeps first-seen order and drops blanks", () => {
    expect(
      menuCategories([
        { category: "Snacks" },
        { category: "Drinks" },
        { category: "Snacks" },
        { category: "" },
        { category: "  " },
        { category: null },
      ]),
    ).toEqual(["Snacks", "Drinks"]);
  });

  it("rename: trims the new name, keeps the old one exactly", () => {
    expect(menuCategoryRenameSchema.parse({ from: "Snacks ", to: "  Chaat  " })).toEqual({ from: "Snacks ", to: "Chaat" });
  });

  it("rename: refuses an empty or over-long name", () => {
    expect(menuCategoryRenameSchema.safeParse({ from: "Snacks", to: "   " }).success).toBe(false);
    expect(menuCategoryRenameSchema.safeParse({ from: "", to: "Chaat" }).success).toBe(false);
    expect(menuCategoryRenameSchema.safeParse({ from: "Snacks", to: "x".repeat(MENU_CATEGORY_MAX) }).success).toBe(true);
    expect(menuCategoryRenameSchema.safeParse({ from: "Snacks", to: "x".repeat(MENU_CATEGORY_MAX + 1) }).success).toBe(false);
  });
});
