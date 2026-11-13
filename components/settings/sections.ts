import {
  Bell,
  CreditCard,
  Gift,
  ListChecks,
  Mic,
  ReceiptText,
  ShoppingBag,
  Star,
  Store,
  Tag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";

/** The Settings areas, in the order the hub shows them. */
export type SettingsSectionId =
  | "store"
  | "orders"
  | "feedback"
  | "offers"
  | "payments"
  | "receipts"
  | "notifications"
  | "voice"
  | "billing"
  | "refer"
  | "survey";

/** The headings the hub groups its sections under, in order. */
export const SETTINGS_GROUPS = ["Your store", "Money", "Phone & counter", "Help us improve"] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroup;
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /**
   * Listed only to an OWNER of a real (non-demo) store. Other sections are
   * listed to every role and disable owner-only controls on the page.
   */
  ownerOnly?: boolean;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "store",
    group: "Your store",
    href: "/settings/store",
    title: "Online store",
    description: "Your store page that customers open from a link or QR.",
    icon: Store,
  },
  {
    id: "orders",
    group: "Your store",
    href: "/settings/orders",
    title: "Online orders",
    // `{catalogue}`: "menu" or "product list" (lib/store-vocabulary.ts fillVocabulary).
    description: "Let customers order from your {catalogue}, for pickup or delivery.",
    icon: ShoppingBag,
  },
  {
    id: "offers",
    group: "Your store",
    href: "/settings/offers",
    title: "Offers",
    description: "Plan discounts, like 10% off 4 or more items.",
    icon: Tag,
  },
  {
    id: "feedback",
    group: "Your store",
    href: "/settings/feedback",
    title: "Customer feedback",
    description: "Ratings and comments from customers after they get their order.",
    icon: Star,
  },
  {
    id: "payments",
    group: "Money",
    href: "/settings/payments",
    title: "Payments",
    description: "UPI ID, pay on delivery and Razorpay.",
    icon: Wallet,
  },
  {
    id: "receipts",
    group: "Money",
    href: "/settings/receipts",
    title: "Receipts",
    description: "What your bills show, GSTIN, and printing.",
    icon: ReceiptText,
  },
  {
    id: "billing",
    group: "Money",
    href: "/settings/billing",
    title: "Plan & billing",
    description: `Your ${BRAND_NAME} plan, usage and upgrades.`,
    icon: CreditCard,
  },
  {
    id: "notifications",
    group: "Phone & counter",
    href: "/settings/notifications",
    title: "Notifications",
    description: "New-order alerts on your phone, even when it is locked.",
    icon: Bell,
  },
  {
    id: "voice",
    group: "Phone & counter",
    href: "/settings/voice",
    title: "Counter & voice",
    description: "The language your staff speak to the POS mic.",
    icon: Mic,
  },
  {
    id: "refer",
    group: "Help us improve",
    href: "/settings/refer",
    title: "Refer a seller",
    description: "Share your link. When a store you invite subscribes, you get free months.",
    icon: Gift,
    ownerOnly: true,
  },
  {
    id: "survey",
    group: "Help us improve",
    href: "/settings/survey",
    title: "Tell us what's hard",
    description: "A short survey on what slows your store down, so we build the right things next.",
    icon: ListChecks,
    ownerOnly: true,
  },
];

/**
 * The sections this viewer sees in the hub: `ownerOnly` ones
 * only for an OWNER, and never on a demo store (lib/referral.ts: demo stores
 * neither earn nor give rewards).
 */
export function settingsSectionsFor(viewer: { isOwner: boolean; isDemo: boolean }): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => !s.ownerOnly || (viewer.isOwner && !viewer.isDemo));
}

/** A viewer's sections under their headings. A heading with nothing to show is left out. */
export function settingsGroupsFor(sections: readonly SettingsSection[]) {
  return SETTINGS_GROUPS.map((title) => ({ title, sections: sections.filter((s) => s.group === title) })).filter(
    (group) => group.sections.length > 0,
  );
}

export function settingsSection(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id)!;
}
