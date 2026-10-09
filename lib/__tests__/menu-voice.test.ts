import { describe, expect, it } from "vitest";

import {
  appendRows,
  buildBulkBody,
  categoryOptions,
  convertToNew,
  draftToRows,
  nameKey,
  parseRupeeInput,
  primaryLabel,
  rowCounts,
  saveSummary,
  skippedReasonText,
  validateRows,
  type MenuVoiceRow,
} from "@/lib/menu-voice";
import type { MenuDraftItem } from "@/lib/parse-menu-types";

function item(over: Partial<MenuDraftItem> & Pick<MenuDraftItem, "key" | "name">): MenuDraftItem {
  return {
    priceInPaise: 1_500,
    category: "Snacks",
    emoji: "🍽️",
    aliases: [],
    action: "create",
    existingMenuItemId: null,
    existingPriceInPaise: null,
    priceSpoken: true,
    ...over,
  };
}

const DRAFT = {
  items: [
    item({ key: "a", name: "Masala chai", priceInPaise: 1_500, category: "Beverages", emoji: "☕", aliases: ["chai"] }),
    item({ key: "b", name: "Samosa", priceInPaise: 0, priceSpoken: false }),
    item({
      key: "c",
      name: "Vada pav",
      priceInPaise: 2_200,
      action: "update_price",
      existingMenuItemId: "m1",
      existingPriceInPaise: 2_000,
    }),
    item({
      key: "d",
      name: "Cutting chai",
      priceInPaise: 1_000,
      action: "unchanged",
      existingMenuItemId: "m2",
      existingPriceInPaise: 1_000,
    }),
  ],
};

describe("draftToRows", () => {
  it("maps items to editable rows with rupee strings and selection defaults", () => {
    const rows = draftToRows(DRAFT, 0);
    expect(rows.map((r) => [r.name, r.price, r.selected, r.action])).toEqual([
      ["Masala chai", "15", true, "create"],
      ["Samosa", "", true, "create"],
      ["Vada pav", "22", true, "update_price"],
      ["Cutting chai", "10", false, "unchanged"],
    ]);
    expect(rows[0]).toMatchObject({ category: "Beverages", emoji: "☕", aliases: ["chai"], key: "t0-0" });
    expect(rows[1].priceSpoken).toBe(false);
  });

  it("keeps paise exact for fractional prices", () => {
    const [row] = draftToRows({ items: [item({ key: "x", name: "Bun", priceInPaise: 1_250 })] });
    expect(row.price).toBe("12.5");
    const built = buildBulkBody([row]);
    expect(built.ok && built.body.items[0].priceInPaise).toBe(1_250);
  });

  it("fills defaults for blank category/emoji and drops nameless items", () => {
    const rows = draftToRows({
      items: [item({ key: "x", name: "  Poha ", category: " ", emoji: "" }), item({ key: "y", name: "   " })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Poha", category: "General", emoji: "🍽️" });
  });

  it("de-duplicates by name within one take (last wins)", () => {
    const rows = draftToRows({
      items: [item({ key: "x", name: "Chai", priceInPaise: 1_000 }), item({ key: "y", name: "chai ", priceInPaise: 1_200 })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe("12");
  });
});

describe("appendRows", () => {
  it("appends new dishes and replaces a re-spoken dish in place, keeping its key", () => {
    const first = draftToRows(DRAFT, 0);
    const second = draftToRows(
      { items: [item({ key: "a", name: "MASALA  CHAI", priceInPaise: 1_800 }), item({ key: "z", name: "Mango lassi", priceInPaise: 6_000 })] },
      1,
    );
    const merged = appendRows(first, second);
    expect(merged.map((r) => r.name)).toEqual(["Masala chai", "Samosa", "Vada pav", "Cutting chai", "Mango lassi"]);
    expect(merged[0]).toMatchObject({ key: "t0-0", price: "18" });
    expect(merged[4].key).toBe("t1-1");
  });

  it("keeps an edited name and an earlier price when the repeat has none", () => {
    const first = draftToRows(DRAFT, 0).map((r) => (r.name === "Samosa" ? { ...r, name: "Samosa (2 pcs)", price: "20" } : r));
    const merged = appendRows(
      first,
      draftToRows({ items: [item({ key: "s", name: "samosa (2 PCS)", priceInPaise: 0, priceSpoken: false, category: "Chaat" })] }, 1),
    );
    expect(merged[1]).toMatchObject({ key: "t0-1", name: "Samosa (2 pcs)", price: "20", category: "Chaat" });
  });

  it("does not mutate its inputs", () => {
    const first = draftToRows(DRAFT, 0);
    const snapshot = JSON.stringify(first);
    appendRows(first, draftToRows({ items: [item({ key: "q", name: "Samosa", priceInPaise: 2_000 })] }, 1));
    expect(JSON.stringify(first)).toBe(snapshot);
  });
});

describe("parseRupeeInput", () => {
  it.each([
    ["15", 1_500],
    ["12.5", 1_250],
    ["19.99", 1_999],
    [" ₹ 1,200 ", 120_000],
  ])("%s → %d paise", (input, paise) => {
    expect(parseRupeeInput(input)).toEqual({ paise });
  });

  it.each([
    ["", "Price needed"],
    ["0", "Price must be more than ₹0"],
    ["12.555", "Use at most 2 decimal places"],
    ["abc", "Enter a price in rupees, like 15 or 12.50"],
    ["-5", "Enter a price in rupees, like 15 or 12.50"],
    ["100001", "Price looks too high — check it"],
  ])("%j is rejected with %s", (input, error) => {
    expect(parseRupeeInput(input)).toEqual({ error });
  });
});

describe("validateRows / buildBulkBody", () => {
  it("blocks saving while a checked row still needs a price", () => {
    const rows = draftToRows(DRAFT, 0);
    const res = buildBulkBody(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toEqual({ "t0-1": { price: "Price needed" } });
  });

  it("ignores unchecked rows, including an invalid one", () => {
    const rows = draftToRows(DRAFT, 0).map((r) => (r.name === "Samosa" ? { ...r, selected: false } : r));
    expect(validateRows(rows)).toEqual({});
  });

  it("builds the bulk body: creates without an id, updates with existingMenuItemId, unchanged never sent", () => {
    const rows = draftToRows(DRAFT, 0).map((r) => (r.name === "Samosa" ? { ...r, price: "20" } : r));
    const res = buildBulkBody(rows);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.items).toEqual([
      { name: "Masala chai", priceInPaise: 1_500, category: "Beverages", emoji: "☕", aliases: ["chai"] },
      { name: "Samosa", priceInPaise: 2_000, category: "Snacks", emoji: "🍽️", aliases: [] },
      { name: "Vada pav", priceInPaise: 2_200, category: "Snacks", emoji: "🍽️", aliases: [], existingMenuItemId: "m1" },
    ]);
    for (const it of res.body.items) expect(Number.isInteger(it.priceInPaise)).toBe(true);
  });

  it("flags empty and duplicate names on checked rows", () => {
    const rows: MenuVoiceRow[] = draftToRows(DRAFT, 0).map((r) => ({ ...r, price: r.price || "20" }));
    rows[0] = { ...rows[0], name: " " };
    rows[1] = { ...rows[1], name: "vada PAV" };
    const errors = validateRows(rows);
    expect(errors["t0-0"]).toEqual({ name: "Name is required" });
    expect(errors["t0-2"]).toEqual({ name: "Another row has this name" });
  });

  it("trims names and categories, defaulting a blank category", () => {
    const [row] = draftToRows({ items: [item({ key: "x", name: "Poha" })] });
    const res = buildBulkBody([{ ...row, name: "  Kanda poha ", category: "  " }]);
    expect(res.ok && res.body.items[0]).toMatchObject({ name: "Kanda poha", category: "General" });
  });
});

describe("counts and copy", () => {
  it("counts checked creates and updates only", () => {
    const rows = draftToRows(DRAFT, 0);
    expect(rowCounts(rows)).toEqual({ create: 2, update: 1 });
    expect(rowCounts(rows.map((r) => ({ ...r, selected: false })))).toEqual({ create: 0, update: 0 });
    // A checked "unchanged" row (shouldn't happen via UI) still isn't counted.
    expect(rowCounts(rows.map((r) => ({ ...r, selected: true })))).toEqual({ create: 2, update: 1 });
  });

  it("labels the primary button", () => {
    expect(primaryLabel({ create: 5, update: 0 })).toBe("Add 5 dishes");
    expect(primaryLabel({ create: 1, update: 0 })).toBe("Add 1 dish");
    expect(primaryLabel({ create: 5, update: 1 })).toBe("Add 5, update 1");
    expect(primaryLabel({ create: 0, update: 2 })).toBe("Update 2 prices");
    expect(primaryLabel({ create: 0, update: 0 })).toBe("Add 0 dishes");
  });

  it("summarises a save", () => {
    expect(saveSummary(5, 1)).toBe("Added 5 dishes, updated 1 price");
    expect(saveSummary(1, 0)).toBe("Added 1 dish");
    expect(saveSummary(0, 2)).toBe("Updated 2 prices");
    expect(saveSummary(0, 0)).toBe("Nothing new was saved");
  });

  it("builds category options from existing + defaults without case duplicates", () => {
    expect(categoryOptions(["Chaat", "snacks", " "])).toEqual(["Chaat", "snacks", "General", "Beverages", "Meals", "Desserts"]);
  });

  it("normalises names for identity", () => {
    expect(nameKey("  Masala   Chai ")).toBe("masala chai");
  });
});

describe("skippedReasonText", () => {
  it("words the bulk skip codes", () => {
    expect(skippedReasonText("not_found")).toBe("no longer on your menu");
    expect(skippedReasonText("duplicate")).toBe("said twice, saved once");
    expect(skippedReasonText("other")).toBe("other");
  });
});

describe("fuzzy matches (alias / spelling)", () => {
  const fuzzyUpdate = item({
    key: "existing:m9",
    name: "Masala Chai",
    priceInPaise: 1_800,
    action: "update_price",
    existingMenuItemId: "m9",
    existingPriceInPaise: 1_500,
    matchedFuzzy: true,
  });
  const fuzzyUnchanged = item({
    key: "existing:m8",
    name: "Bun Maska",
    priceInPaise: 2_000,
    action: "unchanged",
    existingMenuItemId: "m8",
    existingPriceInPaise: 2_000,
    priceSpoken: false,
    matchedFuzzy: true,
  });

  it("starts a fuzzy price update unchecked; an exact one stays checked", () => {
    const [fuzzy, exact] = draftToRows({ items: [fuzzyUpdate, { ...fuzzyUpdate, key: "e", name: "Kadak Chai", matchedFuzzy: false }] });
    expect(fuzzy).toMatchObject({ selected: false, matchedFuzzy: true, action: "update_price" });
    expect(exact).toMatchObject({ selected: true, matchedFuzzy: false });
    expect(rowCounts([fuzzy, exact])).toEqual({ create: 0, update: 1 });
  });

  it("convertToNew turns a fuzzy update into a checked create row, keeping the spoken price", () => {
    const [row] = draftToRows({ items: [fuzzyUpdate] });
    const created = convertToNew(row);
    expect(created).toMatchObject({
      action: "create",
      existingMenuItemId: null,
      existingPriceInPaise: null,
      matchedFuzzy: false,
      selected: true,
      name: "Masala Chai",
      price: "18",
    });
    const res = buildBulkBody([{ ...created, name: "Chai" }]);
    expect(res.ok && res.body.items).toEqual([
      { name: "Chai", priceInPaise: 1_800, category: "Snacks", emoji: "🍽️", aliases: [] },
    ]);
  });

  it("convertToNew on an unchanged row with no spoken price asks for one", () => {
    const [row] = draftToRows({ items: [fuzzyUnchanged] });
    expect(row.selected).toBe(false);
    const created = convertToNew(row);
    expect(created).toMatchObject({ action: "create", selected: true, price: "" });
    expect(validateRows([created])).toEqual({ [created.key]: { price: "Price needed" } });
  });
});
