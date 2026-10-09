import type { PaymentMethod, PaymentStatus, ReceiptPaper } from "@prisma/client";

import { paymentMethodLabel } from "@/lib/cash-tender";

/**
 * The receipt module's shared model. One `ReceiptView` is built per bill
 * (lib/receipt-data.ts, server-only) and rendered three ways:
 *
 * - WhatsApp text — `formatWhatsAppReceiptMessage` (lib/whatsapp-message.ts)
 * - Vendor print page — `/receipts/[bill]` (58/80 mm thermal or A4)
 * - Customer page — `/r/[token]`, public, keyed on `Receipt.publicToken`
 *
 * Pure and client-safe (the Settings preview renders it in the browser). It
 * has no customer fields at all: no phone, name, address or UTR. A receipt can
 * end up in front of anyone the customer forwards it to.
 */

export type ReceiptItem = {
  name: string;
  qty: number;
  priceInPaise: number;
  hsnCode?: string | null;
};

export type ReceiptView = {
  vendorName: string;
  /** "Hyderabad, Telangana" — city and state as one line, or null. */
  vendorLocation: string | null;
  gstin: string | null;
  fssaiNumber: string | null;
  billNumber: string;
  /** Transaction createdAt. An ISO string when it crossed to a client component. */
  createdAt: Date | string;
  items: ReceiptItem[];
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** Storefront order cancelled by the vendor or buyer. */
  cancelled: boolean;
  receiptFooter: string | null;
  /** Absolute `/s/<slug>` link, only when the storefront is published. */
  storefrontUrl: string | null;
  /** Absolute `/r/<token>` link to this receipt, when a base URL is known. */
  receiptUrl: string | null;
};

export const DEFAULT_RECEIPT_FOOTER = "Thanks for visiting!";
export const RECEIPT_FOOTER_MAX = 160;

/** GSTIN format (india-locale rule). State-code / checksum validation is not done. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const GSTIN_FORMAT_MESSAGE = "GSTIN must be 15 characters, like 36ABCDE1234F1Z5";

export type ReceiptState = "paid" | "pending" | "cancelled" | "refunded" | "failed";

export function receiptState(v: Pick<ReceiptView, "paymentStatus" | "cancelled">): ReceiptState {
  if (v.cancelled) return "cancelled";
  switch (v.paymentStatus) {
    case "PAID":
      return "paid";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/** One line for the receipt's status row: "Paid · UPI", "Not paid yet", … */
export function receiptStatusLine(v: Pick<ReceiptView, "paymentStatus" | "cancelled" | "paymentMethod">): string {
  switch (receiptState(v)) {
    case "paid":
      return `Paid · ${paymentMethodLabel(v.paymentMethod)}`;
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Payment failed";
    default:
      return "Not paid yet";
  }
}

export function vendorLocationLine(city: string | null | undefined, state: string | null | undefined): string | null {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Per paper: the named @page (app/globals.css) plus the body width. Thermal
 * widths are the printable area, not the roll.
 */
export const RECEIPT_PAPER: Record<ReceiptPaper, { label: string; sheetClass: string }> = {
  MM58: { label: "58 mm thermal", sheetClass: "receipt-page-mm58 w-[48mm]" },
  MM80: { label: "80 mm thermal", sheetClass: "receipt-page-mm80 w-[72mm]" },
  A4: { label: "A4 / Letter", sheetClass: "receipt-page-a4 w-[120mm] max-w-full" },
};

export function parseReceiptPaper(raw: string | null | undefined, fallback: ReceiptPaper): ReceiptPaper {
  return raw === "MM58" || raw === "MM80" || raw === "A4" ? raw : fallback;
}

/** `/r/<token>` on the configured origin, or null when either is missing. */
export function publicReceiptUrl(token: string | null | undefined, baseUrl: string | null | undefined): string | null {
  const base = baseUrl?.trim().replace(/\/+$/, "");
  if (!token || !base) return null;
  return `${base}/r/${encodeURIComponent(token)}`;
}

/** Vendor-side print page for a bill. */
export function receiptPrintPath(billNumber: string, opts?: { autoprint?: boolean; embed?: boolean }): string {
  const q = new URLSearchParams();
  if (opts?.autoprint) q.set("autoprint", "1");
  if (opts?.embed) q.set("embed", "1");
  const qs = q.toString();
  return `/receipts/${encodeURIComponent(billNumber)}${qs ? `?${qs}` : ""}`;
}
