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
 */

export type AppNavId = "orders" | "drops" | "sell" | "menu" | "transactions" | "analytics" | "settings" | "help";

export type AppNavItem = {
  id: AppNavId;
  href: string;
  label: string;
  /** `tab`: on the phone tab bar. `more`: behind the phone "More" tab. The rail lists both. */
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

/** Path-prefix match on whole segments: `/drops/123` is under `/drops`, `/dropship` is not. */
export function isAppNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The destination the current path belongs to, or null (e.g. a page outside the list). */
export function activeAppNavId(pathname: string): AppNavId | null {
  return APP_NAV_ITEMS.find((item) => isAppNavItemActive(item.href, pathname))?.id ?? null;
}
