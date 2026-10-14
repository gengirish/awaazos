import type { StaffRole } from "@prisma/client";

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
 * The phone tab bar depends on whether the store is published (`appTabBarForRole`):
 * a seller who takes orders online gets Settings on the bar and Sell behind More.
 */

export type AppNavId = "orders" | "drops" | "sell" | "menu" | "transactions" | "analytics" | "settings" | "help";

export type AppNavItem = {
  id: AppNavId;
  href: string;
  label: string;
  /**
   * `tab`: on the phone tab bar. `more`: behind the phone "More" tab. The rail lists both.
   * In `APP_NAV_ITEMS` this is the bar of an unpublished store; `appTabBarForRole` returns
   * the placement a given seller actually sees.
   */
  placement: "tab" | "more";
  /** Hidden from a CASHIER. */
  managerOnly: boolean;
};

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { id: "orders", href: "/orders", label: "Orders", placement: "tab", managerOnly: false },
  { id: "drops", href: "/drops", label: "Drops", placement: "tab", managerOnly: true },
  { id: "sell", href: "/pos", label: "Sell", placement: "tab", managerOnly: false },
  { id: "menu", href: "/menu", label: "Menu", placement: "tab", managerOnly: true },
  { id: "transactions", href: "/transactions", label: "Transactions", placement: "more", managerOnly: true },
  { id: "analytics", href: "/analytics", label: "Analytics", placement: "more", managerOnly: true },
  { id: "settings", href: "/settings", label: "Settings", placement: "more", managerOnly: false },
  { id: "help", href: "/help", label: "Help", placement: "more", managerOnly: false },
];

/** The destinations a staff member of this role is shown, in display order. */
export function appNavItemsForRole(role: StaffRole): AppNavItem[] {
  const isCashier = role === "CASHIER";
  return APP_NAV_ITEMS.filter((item) => !(isCashier && item.managerOnly));
}

/** The phone tab bar holds this many destinations; "More" is the fifth tab. */
export const APP_TAB_BAR_SLOTS = 4;

/**
 * Tab-bar priority once the store is published: orders come in online, so
 * Settings (payments, store, alerts) is worth a slot more than the counter till.
 */
const PUBLISHED_TAB_PRIORITY: readonly AppNavId[] = ["orders", "drops", "menu", "settings", "sell"];

/**
 * The phone tab bar and its "More" sheet for this role.
 *
 * Store not published: the placement in `APP_NAV_ITEMS` (Orders, Drops, Sell, Menu).
 * Store published: the first `APP_TAB_BAR_SLOTS` of `PUBLISHED_TAB_PRIORITY` the
 * role may see (an owner gets Orders, Drops, Menu, Settings, with Sell behind
 * More; a cashier's three destinations all fit, so Sell stays on the bar).
 * Either way each list keeps the order of `APP_NAV_ITEMS`, and `placement` on
 * the returned items says where each one landed.
 */
export function appTabBarForRole(
  role: StaffRole,
  storePublished: boolean,
): { tabs: AppNavItem[]; more: AppNavItem[] } {
  const items = appNavItemsForRole(role);
  const onBar = storePublished
    ? new Set(
        PUBLISHED_TAB_PRIORITY.filter((id) => items.some((item) => item.id === id)).slice(0, APP_TAB_BAR_SLOTS),
      )
    : new Set(items.filter((item) => item.placement === "tab").map((item) => item.id));
  const placed = items.map((item): AppNavItem => ({ ...item, placement: onBar.has(item.id) ? "tab" : "more" }));
  return {
    tabs: placed.filter((item) => item.placement === "tab"),
    more: placed.filter((item) => item.placement === "more"),
  };
}

/** Path-prefix match on whole segments: `/drops/123` is under `/drops`, `/dropship` is not. */
export function isAppNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The destination the current path belongs to, or null (e.g. a page outside the list). */
export function activeAppNavId(pathname: string): AppNavId | null {
  return APP_NAV_ITEMS.find((item) => isAppNavItemActive(item.href, pathname))?.id ?? null;
}
