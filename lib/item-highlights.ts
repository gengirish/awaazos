/**
 * The longer product text in an item's detail sheet (docs/PRODUCT_PAGE_PLAN.md
 * step 4): `MenuItem.details`, `MenuItem.highlights` and `MenuItem.foodType`.
 * Pure and zod-free, so the store page and the item form can import it; the
 * request schemas in lib/zod-menu.ts call these.
 *
 * Rules:
 * 1. Highlights are up to HIGHLIGHTS_MAX label / value pairs ("Fabric" /
 *    "Cotton blend"), in the seller's order. Text is trimmed and spaces
 *    collapsed; a row with both halves blank is dropped; a row with one half
 *    blank, a label used twice (ignoring case) or text over the limits is
 *    refused, never cut. No rows = null.
 * 2. Stored highlights are read leniently (`storedHighlights`): anything
 *    malformed is skipped, so an odd row can never break the store page.
 * 3. Details is free text up to ITEM_DETAILS_MAX, line breaks kept (at most one
 *    blank line in a row). Blank = null. `description` keeps its one-line job.
 * 4. The food mark (`foodType`) is for food stores only and optional: null =
 *    not said, and nothing shows. It never relies on colour alone.
 * 5. None of these reach the voice prompt (`stableMenuJson()` selects its fields).
 */

export const HIGHLIGHTS_MAX = 6;
export const HIGHLIGHT_LABEL_MAX = 24;
export const HIGHLIGHT_VALUE_MAX = 60;
export const ITEM_DETAILS_MAX = 1000;

export type Highlight = { label: string; value: string };

export const FOOD_TYPES = ["VEG", "NON_VEG", "EGG"] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

/** Words for each mark, said next to the symbol (rule 4). */
export const FOOD_TYPE_LABEL: Record<FoodType, string> = {
  VEG: "Veg",
  NON_VEG: "Non-veg",
  EGG: "Contains egg",
};

/** Labels the form offers to fill in; free text otherwise. */
export const HIGHLIGHT_LABEL_SUGGESTIONS: Record<"food" | "goods", readonly string[]> = {
  food: ["Serves", "Weight", "Shelf life", "Spice level"],
  goods: ["Fabric", "Material", "Size guide", "Wash care"],
};

function clean(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

export type HighlightsResult = { ok: true; value: Highlight[] | null } | { ok: false; error: string };

/** Rule 1, for a request body: the rows to store, or why they can't be. */
export function normaliseHighlights(rows: readonly { label: string; value: string }[] | null | undefined): HighlightsResult {
  if (!rows) return { ok: true, value: null };
  const out: Highlight[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = clean(row.label);
    const value = clean(row.value);
    if (!label && !value) continue;
    if (!label || !value) return { ok: false, error: "Each highlight needs a label and a value." };
    if (label.length > HIGHLIGHT_LABEL_MAX) {
      return { ok: false, error: `Keep each label to ${HIGHLIGHT_LABEL_MAX} characters.` };
    }
    if (value.length > HIGHLIGHT_VALUE_MAX) {
      return { ok: false, error: `Keep each value to ${HIGHLIGHT_VALUE_MAX} characters.` };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `"${label}" is there twice.` };
    seen.add(key);
    out.push({ label, value });
  }
  if (out.length > HIGHLIGHTS_MAX) return { ok: false, error: `Up to ${HIGHLIGHTS_MAX} highlights.` };
  return { ok: true, value: out.length > 0 ? out : null };
}

/** Rule 2: the stored JSON as rows, skipping anything malformed. */
export function storedHighlights(json: unknown): Highlight[] {
  if (!Array.isArray(json)) return [];
  const out: Highlight[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const label = clean((row as { label?: unknown }).label);
    const value = clean((row as { value?: unknown }).value);
    if (!label || !value || label.length > HIGHLIGHT_LABEL_MAX || value.length > HIGHLIGHT_VALUE_MAX) continue;
    out.push({ label, value });
    if (out.length === HIGHLIGHTS_MAX) break;
  }
  return out;
}

/** Rule 3: trimmed, spaces tidied, line breaks kept (no more than one blank line); blank → null. */
export function normaliseItemDetails(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : text;
}

export function isFoodType(v: unknown): v is FoodType {
  return typeof v === "string" && (FOOD_TYPES as readonly string[]).includes(v);
}
