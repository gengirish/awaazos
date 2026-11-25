import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  IndianRupee,
  Settings,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

import type { AppNavId } from "@/lib/app-nav";

/**
 * One icon per shell destination. Not a client module on purpose: the shell
 * (client) and the Help page (server) both draw from it.
 *
 * Each icon says what the screen does, and no two look alike:
 * - Menu is the plate (`UtensilsCrossed`) for every store, goods ones included:
 *   one icon for the catalogue keeps the bar the same for every seller.
 * - Sell (`/pos`) is the rupee: the counter takes cash and UPI, so a QR would
 *   name only one of the two.
 * - Transactions is money in and out (`ArrowLeftRight`), not a document, so it
 *   never reads like Orders' clipboard.
 */
export const APP_NAV_ICONS: Record<AppNavId, LucideIcon> = {
  orders: ClipboardList,
  drops: CalendarClock,
  sell: IndianRupee,
  menu: UtensilsCrossed,
  store: Store,
  transactions: ArrowLeftRight,
  analytics: BarChart3,
  settings: Settings,
  help: CircleHelp,
};

/** The icon for a shell destination. */
export function appNavIcon(id: AppNavId): LucideIcon {
  return APP_NAV_ICONS[id];
}
