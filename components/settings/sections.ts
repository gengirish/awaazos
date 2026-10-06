import { Bell, CreditCard, LayoutList, Mic, ShoppingBag, Store, Wallet, type LucideIcon } from "lucide-react";

/** The Settings areas, in the order the hub and the sidebar show them. */
export type SettingsSectionId = "store" | "orders" | "payments" | "notifications" | "voice" | "billing";

export type SettingsSection = {
  id: SettingsSectionId;
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "store",
    href: "/settings/store",
    title: "Online store",
    description: "Your menu page that customers open from a link or QR.",
    icon: Store,
  },
  {
    id: "orders",
    href: "/settings/orders",
    title: "Online orders",
    description: "Let customers order from your menu, for pickup or delivery.",
    icon: ShoppingBag,
  },
  {
    id: "payments",
    href: "/settings/payments",
    title: "Payments",
    description: "UPI ID, pay on delivery and Razorpay.",
    icon: Wallet,
  },
  {
    id: "notifications",
    href: "/settings/notifications",
    title: "Notifications",
    description: "New-order alerts on your phone, even when it is locked.",
    icon: Bell,
  },
  {
    id: "voice",
    href: "/settings/voice",
    title: "Counter & voice",
    description: "The language your staff speak to the POS mic.",
    icon: Mic,
  },
  {
    id: "billing",
    href: "/settings/billing",
    title: "Plan & billing",
    description: "Your AwaazOS plan, usage and upgrades.",
    icon: CreditCard,
  },
];

export const SETTINGS_OVERVIEW = { href: "/settings", title: "Overview", icon: LayoutList } as const;

export function settingsSection(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id)!;
}
