import {
  BarChart3,
  Calculator,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  LayoutGrid,
  ReceiptText,
  Settings,
  Store,
  type LucideIcon,
} from "lucide-react";

import type { AppNavId } from "@/lib/app-nav";

/**
 * One icon per shell destination. Not a client module on purpose: the shell
 * (client) and the Help page (server) both draw from it.
 *
 * The catalogue (`/menu`) is a grid for every store: the app sells more than
 * food, and a kitchen on the GENERAL sign-up type may not be one.
 */
export const APP_NAV_ICONS: Record<AppNavId, LucideIcon> = {
  orders: ClipboardList,
  drops: CalendarClock,
  sell: Calculator,
  menu: LayoutGrid,
  store: Store,
  transactions: ReceiptText,
  analytics: BarChart3,
  settings: Settings,
  help: CircleHelp,
};

/** The icon for a shell destination. */
export function appNavIcon(id: AppNavId): LucideIcon {
  return APP_NAV_ICONS[id];
}
