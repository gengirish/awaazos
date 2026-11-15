import { describe, expect, it } from "vitest";

import {
  HIGHLIGHT_LABEL_MAX,
  HIGHLIGHT_VALUE_MAX,
  HIGHLIGHTS_MAX,
  isFoodType,
  ITEM_DETAILS_MAX,
  normaliseHighlights,
  normaliseItemDetails,
  storedHighlights,
} from "@/lib/item-highlights";
import { itemDetailsSchema, itemHighlightsSchema, menuItemUpdateSchema } from "@/lib/zod-menu";

describe("normaliseHighlights", () => {
  it("trims, collapses spaces and drops rows with both halves blank", () => {
    expect(
      normaliseHighlights([
        { label: "  Fabric ", value: "Cotton   blend" },
        { label: " ", value: "" },
        { label: "Wash care", value: "Hand wash" },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { label: "Fabric", value: "Cotton blend" },
        { label: "Wash care", value: "Hand wash" },
      ],
    });
  });

  it("is null when nothing is left", () => {
    expect(normaliseHighlights([{ label: "", value: " " }])).toEqual({ ok: true, value: null });
    expect(normaliseHighlights(null)).toEqual({ ok: true, value: null });
  });

  it("refuses a half-filled row, a repeated label and text over the limits", () => {
    expect(normaliseHighlights([{ label: "Fabric", value: "" }]).ok).toBe(false);
    expect(normaliseHighlights([{ label: "", value: "Cotton" }]).ok).toBe(false);
    expect(
      normaliseHighlights([
        { label: "Fabric", value: "Cotton" },
        { label: "fabric", value: "Silk" },
      ]).ok,
    ).toBe(false);
    expect(normaliseHighlights([{ label: "x".repeat(HIGHLIGHT_LABEL_MAX + 1), value: "v" }]).ok).toBe(false);
    expect(normaliseHighlights([{ label: "l", value: "x".repeat(HIGHLIGHT_VALUE_MAX + 1) }]).ok).toBe(false);
  });

  it(`allows ${HIGHLIGHTS_MAX} rows, not more`, () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: "v" }));
    expect(normaliseHighlights(rows(HIGHLIGHTS_MAX)).ok).toBe(true);
    expect(normaliseHighlights(rows(HIGHLIGHTS_MAX + 1)).ok).toBe(false);
  });
});

describe("storedHighlights", () => {
  it("skips anything malformed instead of throwing", () => {
    expect(storedHighlights(null)).toEqual([]);
    expect(storedHighlights("Fabric: cotton")).toEqual([]);
    expect(
      storedHighlights([{ label: "Fabric", value: "Cotton" }, { label: 3 }, null, { label: "Serves", value: " 2 " }]),
    ).toEqual([
      { label: "Fabric", value: "Cotton" },
      { label: "Serves", value: "2" },
    ]);
  });

  it(`never returns more than ${HIGHLIGHTS_MAX}`, () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, value: "v" }));
    expect(storedHighlights(many)).toHaveLength(HIGHLIGHTS_MAX);
  });
});

describe("normaliseItemDetails", () => {
  it("keeps line breaks, tidies spaces and allows one blank line at most", () => {
    expect(normaliseItemDetails("  Made fresh.  \r\n\r\n\r\n  Keeps   2 days. ")).toBe("Made fresh.\n\nKeeps 2 days.");
  });

  it("is null when blank", () => {
    expect(normaliseItemDetails("  \n ")).toBeNull();
    expect(normaliseItemDetails(null)).toBeNull();
  });
});

describe("request schemas", () => {
  it("refuses details over the limit after tidying", () => {
    expect(itemDetailsSchema.safeParse("x".repeat(ITEM_DETAILS_MAX)).success).toBe(true);
    expect(itemDetailsSchema.safeParse("x".repeat(ITEM_DETAILS_MAX + 1)).success).toBe(false);
  });

  it("turns highlight rows into the stored shape and reports a refusal", () => {
    expect(itemHighlightsSchema.parse([{ label: " Serves ", value: "2" }])).toEqual([{ label: "Serves", value: "2" }]);
    expect(itemHighlightsSchema.parse([])).toBeNull();
    const bad = itemHighlightsSchema.safeParse([{ label: "Serves", value: "" }]);
    expect(bad.success).toBe(false);
  });

  it("accepts the three fields on an update, and null clears them", () => {
    const parsed = menuItemUpdateSchema.parse({ details: null, highlights: null, foodType: null });
    expect(parsed).toMatchObject({ details: null, highlights: null, foodType: null });
    expect(menuItemUpdateSchema.safeParse({ foodType: "VEGAN" }).success).toBe(false);
  });

  it("knows the food types", () => {
    expect(isFoodType("NON_VEG")).toBe(true);
    expect(isFoodType("vegan")).toBe(false);
  });
});
