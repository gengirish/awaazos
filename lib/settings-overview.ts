import type { FulfilmentMode, Plan, ReceiptPaper, StaffRole } from "@prisma/client";

import { PLAN_LIMITS, VOICE_LANGUAGES } from "./constants";
import { formatAverageRating, ratingCountLabel, type RatingSummary } from "./order-feedback";
import { vocabularyForKind, type StoreKind } from "./store-vocabulary";

/**
 * Pure helpers behind the Settings hub (/settings): one-line status per area
 * and the "setup checklist" for taking online orders. Kept free of Prisma and
 * React so the wording is unit-tested and identical wherever it is shown.
 *
 * The checklist is drawn by components/setup/SetupChecklistCard.tsx (Settings,
 * /orders, /pos, /drops) from lib/setup-checklist-server.ts.
 *
 * Copy that names the catalogue follows the store's kind (lib/store-vocabulary.ts):
 * "Order from menu" for a kitchen, "Order any time" for any other store.
 */

export type SettingsSnapshot = {
  slug: string;
  publishStorefront: boolean;
  acceptMenuOrders: boolean;
  menuFulfilmentMode: FulfilmentMode;
  upiId: string | null;
  acceptPayOnDelivery: boolean;
  razorpayConfigured: boolean;
  /** `isOnlinePaymentEnabled`: Razorpay can take a payment right now, which needs no UPI ID. */
  onlinePayment?: boolean;
  voiceLang: string;
  plan: Plan;
  /**
   * Billing state when it isn't simply "on `plan`" (lib/plan.ts billingAccess):
   * days left in the free trial, or locked. Omitted for paid and free vendors.
   */
  billing?: { kind: "trial"; daysLeft: number } | { kind: "locked" };
  availableItemCount: number;
  /** Drops this vendor has ever created, drafts included. */
  dropCount: number;
  /** VAPID keys present on this deployment (lib/push.ts isPushConfigured). */
  pushConfigured: boolean;
  /** Opted-in alert devices across the vendor's active staff. */
  pushDeviceCount: number;
  /** Shown on the store. Format-checked only, never verified with FSSAI. */
  fssaiNumber: string | null;
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
  kind: StoreKind = "food",
): SectionStatus {
  const title = vocabularyForKind(kind).catalogueOrdersTitle;
  return s.acceptMenuOrders
    ? { text: `${title}: On · ${FULFILMENT_LABEL[s.menuFulfilmentMode]}`, on: true }
    : { text: `${title}: Off`, on: false };
}

/** `activeOffers` = offers switched on (their dates are not looked at here). */
export function offersStatus(activeOffers: number): SectionStatus {
  return activeOffers > 0
    ? { text: `${activeOffers} ${activeOffers === 1 ? "offer" : "offers"} on`, on: true }
    : { text: "No offers on", on: false };
}

/** Settings → Tell us what's hard. */
export function surveyStatus(answered: boolean): SectionStatus {
  return answered ? { text: "Answered", on: true } : { text: "Not answered yet", on: false };
}

/** Settings → Customer feedback. */
export function feedbackStatus(s: RatingSummary): SectionStatus {
  return s.count > 0
    ? { text: `${formatAverageRating(s)} from ${ratingCountLabel(s.count)}`, on: true }
    : { text: "No ratings yet", on: false };
}

/** Settings → Refer a seller, from `ReferralSummary` counts. */
export function referStatus(s: { signedUp: number; monthsRedeemed: number; monthsBanked: number }): SectionStatus {
  const months = s.monthsRedeemed + s.monthsBanked;
  if (months > 0) return { text: `${months} free ${months === 1 ? "month" : "months"} earned`, on: true };
  if (s.signedUp > 0) return { text: `${s.signedUp} ${s.signedUp === 1 ? "store" : "stores"} signed up`, on: true };
  return { text: "No invites yet", on: false };
}

export function paymentsStatus(
  s: Pick<SettingsSnapshot, "upiId" | "acceptPayOnDelivery" | "razorpayConfigured" | "onlinePayment">,
): SectionStatus {
  const parts: StatusPart[] = [
    { label: "UPI", on: Boolean(s.upiId?.trim()) },
    { label: "Pay on delivery", on: s.acceptPayOnDelivery },
    { label: "Razorpay", on: s.razorpayConfigured },
  ];
  return {
    text: parts.map((p) => `${p.label} ${p.on ? "on" : "off"}`).join(" · "),
    on: parts[0]!.on || parts[1]!.on || Boolean(s.onlinePayment),
    parts,
  };
}

const RECEIPT_PAPER_SHORT: Record<ReceiptPaper, string> = { MM58: "58 mm", MM80: "80 mm", A4: "A4" };

export function receiptsStatus(s: { receiptPaper: ReceiptPaper; autoPrintReceipt: boolean; gstin: string | null }): SectionStatus {
  const bits = [`${RECEIPT_PAPER_SHORT[s.receiptPaper]} paper`];
  if (s.gstin) bits.push("GSTIN set");
  if (s.autoPrintReceipt) bits.push("auto-print on");
  return { text: bits.join(" · "), on: true };
}

export function voiceLanguageLabel(voiceLang: string): string {
  return (
    VOICE_LANGUAGES.find((l) => l.value === voiceLang)?.label ?? LEGACY_VOICE_LABEL[voiceLang] ?? "English"
  );
}

export function voiceStatus(s: Pick<SettingsSnapshot, "voiceLang">): SectionStatus {
  return { text: voiceLanguageLabel(s.voiceLang), on: true };
}

export function planStatus(s: Pick<SettingsSnapshot, "plan" | "billing">): SectionStatus {
  if (s.billing?.kind === "locked") return { text: "No active plan", on: false };
  if (s.billing?.kind === "trial") {
    const d = s.billing.daysLeft;
    return { text: `Free trial · ${d} ${d === 1 ? "day" : "days"} left`, on: true };
  }
  return { text: `${PLAN_LIMITS[s.plan].label} plan`, on: true };
}

export function notificationsStatus(
  s: Pick<SettingsSnapshot, "pushConfigured" | "pushDeviceCount">,
): SectionStatus {
  if (!s.pushConfigured) return { text: "Not set up", on: false };
  if (s.pushDeviceCount <= 0) return { text: "Off", on: false };
  return { text: `On · ${s.pushDeviceCount} ${s.pushDeviceCount === 1 ? "device" : "devices"}`, on: true };
}

export type ChecklistItemId = "menu_items" | "publish_store" | "payment_method" | "first_drop" | "fssai_number";

export type ChecklistItem = {
  id: ChecklistItemId;
  /** Worth doing, but customers can already order without it. Alone, it is one slim row, not the card. */
  reminder?: boolean;
  text: string;
  href: string;
  linkText: string;
  /** Lowest staff role that can do this step (the page behind `href` enforces it). */
  minRole: StaffRole;
  /** A second way to tick the step off, in words. */
  hint?: string;
};

export type SetupChecklistInput = Pick<
  SettingsSnapshot,
  | "availableItemCount"
  | "publishStorefront"
  | "upiId"
  | "acceptPayOnDelivery"
  | "onlinePayment"
  | "acceptMenuOrders"
  | "dropCount"
  | "fssaiNumber"
>;

/**
 * What is still missing before customers can order online. Empty means
 * everything essential is done, and the checklist is hidden.
 */
export function setupChecklist(s: SetupChecklistInput, kind: StoreKind = "food"): ChecklistItem[] {
  const vocab = vocabularyForKind(kind);
  const items: ChecklistItem[] = [];
  if (s.availableItemCount <= 0) {
    items.push({
      id: "menu_items",
      text: `Add at least one item to your ${vocab.catalogue}`,
      href: "/menu",
      linkText: `Go to ${vocab.catalogueTitle}`,
      // The API lets a cashier add items, but the shell hides Menu from them (lib/app-nav.ts).
      minRole: "MANAGER",
    });
  }
  if (!s.publishStorefront) {
    items.push({
      id: "publish_store",
      text: "Publish your online store",
      href: "/settings/store",
      linkText: "Go to Online store",
      minRole: "OWNER",
    });
  }
  if (!s.upiId?.trim() && !s.acceptPayOnDelivery && !s.onlinePayment) {
    items.push({
      id: "payment_method",
      text: "Add a UPI ID or allow pay on delivery",
      href: "/settings/payments",
      linkText: "Go to Payments",
      minRole: "OWNER",
    });
  }
  // Customers need something to order from: a drop, or the everyday menu.
  if (s.dropCount <= 0 && !s.acceptMenuOrders) {
    items.push({
      id: "first_drop",
      text: `Create your first pre-order or turn on ${vocab.catalogueOrders.toLowerCase()}`,
      href: "/drops/new",
      linkText: "Create a pre-order",
      minRole: "MANAGER",
      hint: `To sell from your everyday ${vocab.catalogue} instead, the owner turns on ${vocab.catalogueOrdersTitle} in Settings → Online orders.`,
    });
  }
  // A prompt, not a gate: nothing refuses a food store without one. Goods stores
  // keep the field in Settings, but many don't need a licence, so no step.
  if (kind === "food" && !s.fssaiNumber?.trim()) {
    items.push({
      id: "fssai_number",
      reminder: true,
      text: "Add your FSSAI number so buyers can trust your food",
      href: "/settings/store",
      linkText: "Go to Online store",
      minRole: "OWNER",
    });
  }
  return items;
}

const STAFF_ROLE_RANK: Record<StaffRole, number> = { CASHIER: 0, MANAGER: 1, OWNER: 2 };

/** Only the steps this staff member can act on; nobody is sent to a screen that refuses them. */
export function checklistForRole(items: ChecklistItem[], role: StaffRole): ChecklistItem[] {
  return items.filter((item) => STAFF_ROLE_RANK[role] >= STAFF_ROLE_RANK[item.minRole]);
}

/** Old single-page anchors (`/settings#storefront`) → the section that replaced them. */
export const LEGACY_SETTINGS_ANCHORS: Record<string, string> = {
  storefront: "/settings/store",
  "pre-orders": "/settings/payments",
  "menu-orders": "/settings/orders",
  "online-payments": "/settings/payments",
};
