/**
 * The seller's Menu screen (/menu) filter: a search over name, description,
 * aliases and category (lib/store-search.ts), plus Selling / Sold out, and Low
 * stock once any item tracks stock (lib/inventory.ts). Pure and client-safe;
 * the screen already holds every item, so nothing is fetched.
 *
 * A tracked item with nothing left counts as sold out even while its "Selling"
 * switch is on: buyers can't order it.
 *
 * Filtering only hides cards. The list MenuGrid saves on reorder is always the
 * whole menu, and reordering is off while a filter is on (a move between two
 * visible cards would jump over hidden ones).
 */

import { stockState } from "@/lib/inventory";
import { itemSearchText, matchesSearch } from "@/lib/store-search";

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

export type MenuFilter = { terms: readonly string[]; status: MenuStatusFilter };

/** True when the filter hides nothing: no words typed and "All". */
export function isMenuFilterEmpty(filter: MenuFilter): boolean {
  return filter.terms.length === 0 && filter.status === "all";
}

export function menuItemMatches(item: MenuFilterItem, filter: MenuFilter): boolean {
  if (filter.status === "selling" && isMenuItemSoldOut(item)) return false;
  if (filter.status === "sold_out" && !isMenuItemSoldOut(item)) return false;
  if (filter.status === "low_stock" && !isMenuItemLowStock(item)) return false;
  return matchesSearch(itemSearchText(item, item.category), filter.terms);
}
