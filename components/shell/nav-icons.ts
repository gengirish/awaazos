import {
  BarChart3,
  Calculator,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  Package,
  ReceiptText,
  Settings,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

import type { AppNavId } from "@/lib/app-nav";
import type { StoreKind } from "@/lib/store-vocabulary";

/**
 * One icon per shell destination. Not a client module on purpose: the shell
 * (client) and the Help page (server) both draw from it.
 */
export const APP_NAV_ICONS: Record<AppNavId, LucideIcon> = {
  orders: ClipboardList,
  drops: CalendarClock,
  sell: Calculator,
  menu: UtensilsCrossed,
  transactions: ReceiptText,
  analytics: BarChart3,
  settings: Settings,
  help: CircleHelp,
};

/** The icon for a destination in this kind of store: a product store's catalogue is a box, not cutlery. */
export function appNavIcon(id: AppNavId, kind: StoreKind): LucideIcon {
  return id === "menu" && kind === "goods" ? Package : APP_NAV_ICONS[id];
}
