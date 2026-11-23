import type { StaffRole } from "@prisma/client";

import { vocabularyForKind, type StoreKind } from "@/lib/store-vocabulary";

/**
 * Destinations of the signed-in app shell (components/shell). Pure and
 * client-safe: the bottom tab bar, the "More" sheet and the md+ rail are all
 * built from this one list.
 *
 * Visibility is cosmetic. Every page still enforces its own role with
 * `requireVendorRole`; hiding a link only keeps a cashier from tapping into a
 * dead end. `/drops` (the list) and `/analytics` require MANAGER; Menu and
 * Transactions are hidden from cashiers by product choice (they're owner tools).
 * Help (`/help`, content in lib/help-guide.ts) describes only what this list shows a role.
 *
 * The list is in the order sellers asked for: the catalogue, orders in, the
 * store buyers see, pre-orders, then the less used screens, Settings last.
 * The rail shows it as is; the phone bar (`appTabBarForRole`) takes four of
 * them, with Store in the middle and More as the last tab.
 *
 * Labels follow what the store sells (lib/store-vocabulary.ts): `/menu` is
 * "Menu" for a kitchen and "Products" for any other store.
 */

export type AppNavId =
  | "orders"
  | "menu"
  | "store"
  | "drops"
  | "sell"
  | "transactions"
  | "analytics"
  | "settings"
  | "help";

export type AppNavItem = {
  id: AppNavId;
  href: string;
  label: string;
  /** Hidden from a CASHIER. */
  managerOnly: boolean;
};

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { id: "menu", href: "/menu", label: "Menu", managerOnly: true },
  { id: "orders", href: "/orders", label: "Orders", managerOnly: false },
  { id: "store", href: "/store", label: "Store", managerOnly: false },
  { id: "drops", href: "/drops", label: "Pre-orders", managerOnly: true },
  { id: "sell", href: "/pos", label: "Sell", managerOnly: false },
  { id: "transactions", href: "/transactions", label: "Transactions", managerOnly: true },
  { id: "analytics", href: "/analytics", label: "Analytics", managerOnly: true },
  { id: "help", href: "/help", label: "Help", managerOnly: false },
  { id: "settings", href: "/settings", label: "Settings", managerOnly: false },
];

/** The destinations a staff member of this role is shown, in display order, labelled for the store's kind. */
export function appNavItemsForRole(role: StaffRole, kind: StoreKind = "food"): AppNavItem[] {
  const isCashier = role === "CASHIER";
  const catalogueTitle = vocabularyForKind(kind).catalogueTitle;
  return APP_NAV_ITEMS.filter((item) => !(isCashier && item.managerOnly)).map((item) =>
    item.id === "menu" ? { ...item, label: catalogueTitle } : item,
  );
}

/** The phone tab bar holds at most this many destinations; "More" is the last tab. */
export const APP_TAB_BAR_SLOTS = 4;

/** The destination drawn raised in the middle of the phone bar. */
export const APP_CENTRE_TAB: AppNavId = "store";

/**
 * The phone bar, left to right, before "More": Menu, Orders, Store (the middle
 * of the five slots), then a fourth slot that follows how the store sells. A
 * published store takes pre-orders online, so Pre-orders is fourth; an
 * unpublished one sells at the counter (and lands on /pos), so Sell stays.
 * Settings is always behind More, the last tab.
 * A cashier has no catalogue: Orders, Sell, Store, with Settings behind More.
 */
const TAB_BAR: Record<"published" | "unpublished" | "cashier", readonly AppNavId[]> = {
  published: ["menu", "orders", "store", "drops"],
  unpublished: ["menu", "orders", "store", "sell"],
  cashier: ["orders", "sell", "store"],
};

/**
 * The phone tab bar and its "More" sheet for this role. Tabs come in bar order
 * (`TAB_BAR`); the sheet keeps the order of `APP_NAV_ITEMS`.
 */
export function appTabBarForRole(
  role: StaffRole,
  storePublished: boolean,
  kind: StoreKind = "food",
): { tabs: AppNavItem[]; more: AppNavItem[] } {
  const items = appNavItemsForRole(role, kind);
  const order = role === "CASHIER" ? TAB_BAR.cashier : storePublished ? TAB_BAR.published : TAB_BAR.unpublished;
  const tabs = order
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is AppNavItem => item !== undefined)
    .slice(0, APP_TAB_BAR_SLOTS);
  const onBar = new Set(tabs.map((item) => item.id));
  const more = items.filter((item) => !onBar.has(item.id));
  return { tabs, more };
}

/** Path-prefix match on whole segments: `/drops/123` is under `/drops`, `/dropship` is not. */
export function isAppNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The destination the current path belongs to, or null (e.g. a page outside the list). */
export function activeAppNavId(pathname: string): AppNavId | null {
  return APP_NAV_ITEMS.find((item) => isAppNavItemActive(item.href, pathname))?.id ?? null;
}
