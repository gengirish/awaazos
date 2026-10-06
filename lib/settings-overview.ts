import type { FulfilmentMode, Plan } from "@prisma/client";

import { PLAN_LIMITS, VOICE_LANGUAGES } from "./constants";

/**
 * Pure helpers behind the Settings hub (/settings): one-line status per area
 * and the "setup checklist" for taking online orders. Kept free of Prisma and
 * React so the wording is unit-tested and identical wherever it is shown.
 */

export type SettingsSnapshot = {
  slug: string;
  publishStorefront: boolean;
  acceptMenuOrders: boolean;
  menuFulfilmentMode: FulfilmentMode;
  upiId: string | null;
  acceptPayOnDelivery: boolean;
  razorpayConfigured: boolean;
  voiceLang: string;
  plan: Plan;
  availableItemCount: number;
  /** VAPID keys present on this deployment (lib/push.ts isPushConfigured). */
  pushConfigured: boolean;
  /** Opted-in alert devices across the vendor's active staff. */
  pushDeviceCount: number;
};

/** One on/off fact inside a status line, e.g. "UPI" on. */
export type StatusPart = { label: string; on: boolean };

export type SectionStatus = {
  /** Plain-text summary (also the accessible text when `parts` is absent). */
  text: string;
  /** Whether the area is switched on / set up. Drives the icon, never colour alone. */
  on: boolean;
  parts?: StatusPart[];
};

const FULFILMENT_LABEL: Record<FulfilmentMode, string> = {
  PICKUP: "Pickup only",
  DELIVERY: "Delivery only",
  BOTH: "Pickup or delivery",
};

/** Legacy codes still allowed in the DB (see SUPPORTED_VOICE_LANGS). */
const LEGACY_VOICE_LABEL: Record<string, string> = {
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ta-IN": "Tamil",
};

export function storeStatus(s: Pick<SettingsSnapshot, "slug" | "publishStorefront">): SectionStatus {
  return s.publishStorefront
    ? { text: `Live · /s/${s.slug}`, on: true }
    : { text: "Not published", on: false };
}

export function ordersStatus(
  s: Pick<SettingsSnapshot, "acceptMenuOrders" | "menuFulfilmentMode">,
): SectionStatus {
  return s.acceptMenuOrders
    ? { text: `Order from menu: On · ${FULFILMENT_LABEL[s.menuFulfilmentMode]}`, on: true }
    : { text: "Order from menu: Off", on: false };
}

export function paymentsStatus(
  s: Pick<SettingsSnapshot, "upiId" | "acceptPayOnDelivery" | "razorpayConfigured">,
): SectionStatus {
  const parts: StatusPart[] = [
    { label: "UPI", on: Boolean(s.upiId?.trim()) },
    { label: "Pay on delivery", on: s.acceptPayOnDelivery },
    { label: "Razorpay", on: s.razorpayConfigured },
  ];
  return {
    text: parts.map((p) => `${p.label} ${p.on ? "on" : "off"}`).join(" · "),
    on: parts[0]!.on || parts[1]!.on,
    parts,
  };
}

export function voiceLanguageLabel(voiceLang: string): string {
  return (
    VOICE_LANGUAGES.find((l) => l.value === voiceLang)?.label ?? LEGACY_VOICE_LABEL[voiceLang] ?? "English"
  );
}

export function voiceStatus(s: Pick<SettingsSnapshot, "voiceLang">): SectionStatus {
  return { text: voiceLanguageLabel(s.voiceLang), on: true };
}

export function planStatus(s: Pick<SettingsSnapshot, "plan">): SectionStatus {
  return { text: `${PLAN_LIMITS[s.plan].label} plan`, on: true };
}

export function notificationsStatus(
  s: Pick<SettingsSnapshot, "pushConfigured" | "pushDeviceCount">,
): SectionStatus {
  if (!s.pushConfigured) return { text: "Not set up", on: false };
  if (s.pushDeviceCount <= 0) return { text: "Off", on: false };
  return { text: `On · ${s.pushDeviceCount} ${s.pushDeviceCount === 1 ? "device" : "devices"}`, on: true };
}

export type ChecklistItemId = "menu_items" | "publish_store" | "payment_method";

export type ChecklistItem = { id: ChecklistItemId; text: string; href: string; linkText: string };

/**
 * What is still missing before customers can order online. Empty means
 * everything essential is done, and the hub hides the checklist.
 */
export function setupChecklist(
  s: Pick<SettingsSnapshot, "availableItemCount" | "publishStorefront" | "upiId" | "acceptPayOnDelivery">,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (s.availableItemCount <= 0) {
    items.push({
      id: "menu_items",
      text: "Add at least one item to your menu",
      href: "/menu",
      linkText: "Go to Menu",
    });
  }
  if (!s.publishStorefront) {
    items.push({
      id: "publish_store",
      text: "Publish your online store",
      href: "/settings/store",
      linkText: "Go to Online store",
    });
  }
  if (!s.upiId?.trim() && !s.acceptPayOnDelivery) {
    items.push({
      id: "payment_method",
      text: "Add a UPI ID or allow pay on delivery",
      href: "/settings/payments",
      linkText: "Go to Payments",
    });
  }
  return items;
}

/** Old single-page anchors (`/settings#storefront`) → the section that replaced them. */
export const LEGACY_SETTINGS_ANCHORS: Record<string, string> = {
  storefront: "/settings/store",
  "pre-orders": "/settings/payments",
  "menu-orders": "/settings/orders",
  "online-payments": "/settings/payments",
};
