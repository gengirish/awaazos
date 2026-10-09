/**
 * Voice menu builder: pure state for the review table in
 * `components/menu/VoiceMenuPanel.tsx`. A parsed `MenuDraft`
 * (POST /api/ai/parse-menu) becomes editable rows; the vendor reviews them and
 * the rows become the POST /api/menu/bulk body. No React, no fetch — unit-tested
 * in `lib/__tests__/menu-voice.test.ts`.
 *
 * Rules:
 * - Prices are edited as rupee strings and converted with `rupeesToPaise` only
 *   when the body is built. No float maths on money here.
 * - A row whose price the vendor didn't say (`priceSpoken: false`) starts empty
 *   and must be filled before saving — voice never invents a price.
 * - "unchanged" rows (already on the menu at that price) are shown for context,
 *   unchecked and never sent.
 * - "Speak again" appends: a dish heard again (same name) updates the earlier
 *   row in place (see `mergeRepeat`), so the latest take wins without duplicating rows.
 */
import { paiseToRupees, rupeesToPaise } from "@/lib/currency";
import type { MenuDraft, MenuDraftAction, MenuDraftItem } from "@/lib/parse-menu-types";
import { MENU_BULK_MAX_ITEMS, MENU_MAX_PRICE_PAISE, MENU_NAME_MAX } from "@/lib/zod-menu";

export const DEFAULT_MENU_EMOJI = "🍽️";
export const DEFAULT_MENU_CATEGORY = "General";

// Same caps POST /api/menu/bulk enforces (lib/zod-menu.ts), checked here first so
// the vendor sees an inline error instead of a 400.
export const NAME_MAX = MENU_NAME_MAX;
export const CATEGORY_MAX = 80;
/** ₹1,00,000 — far above any stall dish; guards a mis-heard "15000" for "150". */
export const MAX_PRICE_PAISE = MENU_MAX_PRICE_PAISE;
export const MAX_ROWS_PER_SAVE = MENU_BULK_MAX_ITEMS;

export type MenuVoiceRow = {
  key: string;
  selected: boolean;
  name: string;
  /** Rupees as typed, e.g. "15" or "12.5". Empty when voice didn't give one. */
  price: string;
  category: string;
  emoji: string;
  aliases: string[];
  action: MenuDraftAction;
  existingMenuItemId: string | null;
  existingPriceInPaise: number | null;
  priceSpoken: boolean;
  /** Existing dish found by approximate spelling — the UI asks for a second look. */
  matchedFuzzy: boolean;
};

export type RowErrors = { name?: string; price?: string; category?: string };

export type BulkItem = {
  name: string;
  priceInPaise: number;
  category: string;
  emoji: string;
  aliases: string[];
  existingMenuItemId?: string;
};

export type BulkBody = { items: BulkItem[] };

/** Case/space-insensitive identity for de-duplicating dishes by name. */
export function nameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function paiseToRupeeInput(paise: number): string {
  return String(paiseToRupees(paise));
}

function rowFromItem(item: MenuDraftItem, take: number, index: number): MenuVoiceRow {
  const hasPrice = item.priceSpoken && Number.isInteger(item.priceInPaise) && item.priceInPaise > 0;
  const unchanged = item.action === "unchanged";
  const fuzzy = item.matchedFuzzy === true;
  return {
    // Our own key (not the API's): safe in DOM ids and unique across takes.
    key: `t${take}-${index}`,
    // A price change on a dish matched by alias/spelling waits for the vendor's OK.
    selected: !unchanged && !(fuzzy && item.action === "update_price"),
    name: item.name.trim(),
    price: hasPrice ? paiseToRupeeInput(item.priceInPaise) : "",
    category: item.category?.trim() || DEFAULT_MENU_CATEGORY,
    emoji: item.emoji?.trim() || DEFAULT_MENU_EMOJI,
    aliases: [...(item.aliases ?? [])],
    action: item.action,
    existingMenuItemId: item.existingMenuItemId,
    existingPriceInPaise: item.existingPriceInPaise,
    priceSpoken: hasPrice,
    matchedFuzzy: fuzzy,
  };
}

/**
 * The same dish heard again: the new take's values win (that's why the vendor
 * repeated it), but the row keeps its key and the name as already shown — the
 * vendor may have corrected it — and a price is never lost to a take without one.
 */
function mergeRepeat(prev: MenuVoiceRow, row: MenuVoiceRow): MenuVoiceRow {
  const price = row.price || prev.price;
  return { ...row, key: prev.key, name: prev.name, price, priceSpoken: row.priceSpoken || prev.priceSpoken };
}

/** A parsed draft → review rows. `take` keeps keys unique across "Speak again". */
export function draftToRows(draft: Pick<MenuDraft, "items">, take = 0): MenuVoiceRow[] {
  const rows: MenuVoiceRow[] = [];
  (draft.items ?? []).forEach((item, index) => {
    if (!item || typeof item.name !== "string" || !item.name.trim()) return;
    const row = rowFromItem(item, take, index);
    const dup = rows.findIndex((r) => nameKey(r.name) === nameKey(row.name));
    if (dup >= 0) rows[dup] = mergeRepeat(rows[dup], row);
    else rows.push(row);
  });
  return rows;
}

/**
 * Merge a new take into the current rows. Same dish name → the new row replaces
 * the old one in place (keeping its key so focus/React state stay put); new
 * dishes go to the end.
 */
export function appendRows(prev: readonly MenuVoiceRow[], incoming: readonly MenuVoiceRow[]): MenuVoiceRow[] {
  const next = [...prev];
  for (const row of incoming) {
    const idx = next.findIndex((r) => nameKey(r.name) === nameKey(row.name));
    if (idx >= 0) next[idx] = mergeRepeat(next[idx], row);
    else next.push(row);
  }
  return next;
}

/**
 * "No, add as a new dish": a row matched to an existing dish by alias/spelling
 * becomes a create row. The draft's name for an existing row is the EXISTING
 * dish's name, so it stays only as a starting point for the vendor to edit.
 */
export function convertToNew(row: MenuVoiceRow): MenuVoiceRow {
  return {
    ...row,
    action: "create",
    existingMenuItemId: null,
    existingPriceInPaise: null,
    matchedFuzzy: false,
    selected: true,
    price: row.priceSpoken ? row.price : "",
  };
}

/** Rows that will be sent — checked and not an "unchanged" context row. */
export function isActive(row: MenuVoiceRow): boolean {
  return row.selected && row.action !== "unchanged";
}

/** Rupee input → integer paise, or an error message. */
export function parseRupeeInput(input: string): { paise: number } | { error: string } {
  const s = input.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (s === "") return { error: "Price needed" };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { error: /^\d*\.\d{3,}$/.test(s) ? "Use at most 2 decimal places" : "Enter a price in rupees, like 15 or 12.50" };
  }
  let paise: number;
  try {
    paise = rupeesToPaise(Number(s));
  } catch {
    return { error: "Use at most 2 decimal places" };
  }
  if (paise <= 0) return { error: "Price must be more than ₹0" };
  if (paise > MAX_PRICE_PAISE) return { error: "Price looks too high — check it" };
  return { paise };
}

/** Field errors per row key, for checked rows only. Empty object = valid. */
export function validateRows(rows: readonly MenuVoiceRow[]): Record<string, RowErrors> {
  const errors: Record<string, RowErrors> = {};
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!isActive(row)) continue;
    const e: RowErrors = {};
    const name = row.name.trim();
    if (!name) e.name = "Name is required";
    else if (name.length > NAME_MAX) e.name = `Keep the name under ${NAME_MAX} characters`;
    else {
      const k = nameKey(name);
      if (seen.has(k)) e.name = "Another row has this name";
      else seen.set(k, row.key);
    }
    const price = parseRupeeInput(row.price);
    if ("error" in price) e.price = price.error;
    if (row.category.trim().length > CATEGORY_MAX) e.category = `Keep the category under ${CATEGORY_MAX} characters`;
    if (e.name || e.price || e.category) errors[row.key] = e;
  }
  return errors;
}

export function rowCounts(rows: readonly MenuVoiceRow[]): { create: number; update: number } {
  let create = 0;
  let update = 0;
  for (const row of rows) {
    if (!isActive(row)) continue;
    if (row.action === "update_price" && row.existingMenuItemId) update++;
    else create++;
  }
  return { create, update };
}

function dishes(n: number): string {
  return `${n} ${n === 1 ? "dish" : "dishes"}`;
}

function prices(n: number): string {
  return `${n} ${n === 1 ? "price" : "prices"}`;
}

/** "Add 5 dishes" / "Add 5, update 1" / "Update 1 price". */
export function primaryLabel({ create, update }: { create: number; update: number }): string {
  if (create > 0 && update > 0) return `Add ${create}, update ${update}`;
  if (update > 0) return `Update ${prices(update)}`;
  return `Add ${dishes(create)}`;
}

/** Checked rows → POST /api/menu/bulk body, or the field errors blocking it. */
export function buildBulkBody(
  rows: readonly MenuVoiceRow[],
): { ok: true; body: BulkBody } | { ok: false; errors: Record<string, RowErrors> } {
  const errors = validateRows(rows);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const items: BulkItem[] = [];
  for (const row of rows) {
    if (!isActive(row)) continue;
    const price = parseRupeeInput(row.price);
    if ("error" in price) continue; // unreachable: validated above
    const item: BulkItem = {
      name: row.name.trim(),
      priceInPaise: price.paise,
      category: row.category.trim() || DEFAULT_MENU_CATEGORY,
      emoji: row.emoji.trim() || DEFAULT_MENU_EMOJI,
      aliases: row.aliases,
    };
    if (row.action === "update_price" && row.existingMenuItemId) item.existingMenuItemId = row.existingMenuItemId;
    items.push(item);
  }
  return { ok: true, body: { items } };
}

/** Bulk `skipped[].reason` codes → words for the vendor. */
export function skippedReasonText(reason: string): string {
  if (reason === "not_found") return "no longer on your menu";
  if (reason === "duplicate") return "said twice, saved once";
  return reason;
}

/** "Added 5 dishes, updated 1 price". */
export function saveSummary(created: number, updated: number): string {
  const parts: string[] = [];
  if (created > 0) parts.push(`Added ${dishes(created)}`);
  if (updated > 0) parts.push(`${created > 0 ? "updated" : "Updated"} ${prices(updated)}`);
  if (parts.length === 0) return "Nothing new was saved";
  return parts.join(", ");
}

/** Existing categories plus the defaults, de-duplicated case-insensitively, for the datalist. */
export function categoryOptions(existing: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of [...existing, DEFAULT_MENU_CATEGORY, "Snacks", "Beverages", "Meals", "Desserts"]) {
    const t = c?.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
