import {
  BarChart3,
  Calculator,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  ReceiptText,
  Settings,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

import type { AppNavId } from "@/lib/app-nav";

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
