/**
 * The seller's Menu screen (/menu) filter: a search over name, description,
 * aliases and category (lib/store-search.ts), plus Selling / Sold out, and Low
 * stock once any item tracks stock (lib/inventory.ts), plus one category.
 * Pure and client-safe; the screen already holds every item, so nothing is fetched.
 *
 * Search and the status filter show from `MENU_FILTER_MIN_ITEMS` items (lower than
 * the POS search, `STAFF_SEARCH_MIN_ITEMS`: /menu cards are tall, so a short list
 * already scrolls). The category choice shows whenever there are two categories or
 * more, at any count (lib/menu-category.ts).
 *
 * A tracked item with nothing left counts as sold out even while its "Selling"
 * switch is on: buyers can't order it.
 *
 * Filtering only hides cards. The list MenuGrid saves on reorder is always the
 * whole menu. Reordering is off while words or a status hide cards (a move
 * between two visible cards would jump over hidden ones), but stays on with a
 * category alone: that shows one whole section, and cards only move inside
 * their section anyway.
 */

import { stockState } from "@/lib/inventory";
import { menuCategoryOf } from "@/lib/menu-category";
import { itemSearchText, matchesSearch } from "@/lib/store-search";

/** /menu shows search and Selling / Sold out from this many items. */
export const MENU_FILTER_MIN_ITEMS = 6;

export function showsMenuFilter(itemCount: number): boolean {
  return itemCount >= MENU_FILTER_MIN_ITEMS;
}

export const MENU_STATUS_FILTERS = ["all", "selling", "sold_out", "low_stock"] as const;
export type MenuStatusFilter = (typeof MENU_STATUS_FILTERS)[number];

export const MENU_STATUS_LABELS: Record<MenuStatusFilter, string> = {
  all: "All",
  selling: "Selling",
  sold_out: "Sold out",
  low_stock: "Low stock",
};

/** The filters to offer: "Low stock" only when something is tracked, so a kitchen sees no change. */
export function menuStatusFilters(anyTracked: boolean): readonly MenuStatusFilter[] {
  return anyTracked ? MENU_STATUS_FILTERS : MENU_STATUS_FILTERS.filter((f) => f !== "low_stock");
}

export type MenuFilterItem = {
  name: string;
  description?: string | null;
  aliases?: readonly string[] | null;
  category?: string | null;
  isAvailable: boolean;
  /** Stock left (lib/inventory.ts); null or absent = not tracked. */
  stockLeft?: number | null;
  lowStockAt?: number | null;
};

/** Off sale by hand, or tracked with nothing left. */
export function isMenuItemSoldOut(item: MenuFilterItem): boolean {
  return !item.isAvailable || (item.stockLeft != null && item.stockLeft <= 0);
}

/** Tracked and at or under its low-stock line, sold out or oversold. */
export function isMenuItemLowStock(item: MenuFilterItem): boolean {
  const state = stockState(item.stockLeft ?? null, item.lowStockAt ?? null);
  return state === "low" || state === "sold_out" || state === "oversold";
}

export type MenuFilter = {
  terms: readonly string[];
  status: MenuStatusFilter;
  /** One section only (`menuCategoryOf`); null or absent = every category. */
  category?: string | null;
};

/** True when the filter hides nothing: no words typed, "All", and every category. */
export function isMenuFilterEmpty(filter: MenuFilter): boolean {
  return !filter.category && !hidesInsideSections(filter);
}

/** True when words or a status hide cards inside a section: reordering is off then. */
export function hidesInsideSections(filter: MenuFilter): boolean {
  return filter.terms.length > 0 || filter.status !== "all";
}

export function menuItemMatches(item: MenuFilterItem, filter: MenuFilter): boolean {
  if (filter.category && menuCategoryOf(item) !== filter.category) return false;
  if (filter.status === "selling" && isMenuItemSoldOut(item)) return false;
  if (filter.status === "sold_out" && !isMenuItemSoldOut(item)) return false;
  if (filter.status === "low_stock" && !isMenuItemLowStock(item)) return false;
  return matchesSearch(itemSearchText(item, item.category), filter.terms);
}
