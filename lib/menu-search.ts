/**
 * The seller's Menu screen (/menu) filter: a search over name, description,
 * aliases and category (lib/store-search.ts), plus Selling / Sold out. Pure and
 * client-safe; the screen already holds every item, so nothing is fetched.
 *
 * Filtering only hides cards. The list MenuGrid saves on reorder is always the
 * whole menu, and reordering is off while a filter is on (a move between two
 * visible cards would jump over hidden ones).
 */

import { itemSearchText, matchesSearch } from "@/lib/store-search";

export const MENU_STATUS_FILTERS = ["all", "selling", "sold_out"] as const;
export type MenuStatusFilter = (typeof MENU_STATUS_FILTERS)[number];

export const MENU_STATUS_LABELS: Record<MenuStatusFilter, string> = {
  all: "All",
  selling: "Selling",
  sold_out: "Sold out",
};

export type MenuFilterItem = {
  name: string;
  description?: string | null;
  aliases?: readonly string[] | null;
  category?: string | null;
  isAvailable: boolean;
};

export type MenuFilter = { terms: readonly string[]; status: MenuStatusFilter };

/** True when the filter hides nothing: no words typed and "All". */
export function isMenuFilterEmpty(filter: MenuFilter): boolean {
  return filter.terms.length === 0 && filter.status === "all";
}

export function menuItemMatches(item: MenuFilterItem, filter: MenuFilter): boolean {
  if (filter.status === "selling" && !item.isAvailable) return false;
  if (filter.status === "sold_out" && item.isAvailable) return false;
  return matchesSearch(itemSearchText(item, item.category), filter.terms);
}
