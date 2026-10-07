import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";

export type ReceiptMessageInput = {
  vendorName: string;
  billNumber: string;
  /** Transaction createdAt */
  createdAt: Date;
  items: { name: string; qty: number; priceInPaise: number; hsnCode?: string | null }[];
  taxPaise: number;
  totalPaise: number;
  receiptFooter?: string | null;
  /** VendorSettings.fssaiNumber — printed when set (home food businesses must show it). */
  fssaiNumber?: string | null;
  /**
   * Absolute storefront URL (`https://<host>/s/<slug>`). The caller passes it
   * only when `publishStorefront` is on and a base URL is configured; the
   * formatter never builds it, so it can't leak an unpublished storefront.
   */
  storefrontUrl?: string | null;
};

/**
 * Absolute storefront link for a receipt, or null when it must be omitted:
 * storefront not published, or no configured base URL. Env-only on purpose —
 * never derive the origin from a request Host header.
 */
export function receiptStorefrontUrl(args: {
  slug: string;
  publishStorefront: boolean | null | undefined;
  baseUrl: string | null | undefined;
}): string | null {
  if (!args.publishStorefront) return null;
  const base = args.baseUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/s/${encodeURIComponent(args.slug)}`;
}

/**
 * Plain-text WhatsApp body (Markdown-style asterisks for bold on WhatsApp).
 */
export function formatWhatsAppReceiptMessage(input: ReceiptMessageInput): string {
  const dateLine = formatIstDateTime(input.createdAt);
  const lines: string[] = [
    `🧾 *${input.vendorName}*`,
    `Bill: ${input.billNumber}`,
    `Date: ${dateLine} IST`,
    "",
  ];

  for (const it of input.items) {
    const lineTotal = it.priceInPaise * it.qty;
    lines.push(`${it.qty} × ${it.name}     ${formatINR(lineTotal)}`);
    if (it.hsnCode) {
      lines.push(`  HSN/SAC: ${it.hsnCode}`);
    }
  }

  lines.push("");

  if (input.taxPaise > 0) {
    lines.push(`Tax: ${formatINR(input.taxPaise)}`);
  }

  lines.push(`*Total: ${formatINR(input.totalPaise)}*`, "");

  const fssai = input.fssaiNumber?.trim();
  if (fssai) {
    lines.push(`FSSAI Lic. No: ${fssai}`, "");
  }

  lines.push(input.receiptFooter?.trim() || "Thanks for visiting!");
  if (input.storefrontUrl) {
    lines.push(`Order again: ${input.storefrontUrl}`);
  }
  lines.push("Powered by AwaazOS 🇮🇳");

  return lines.join("\n");
}

/**
 * wa.me link that opens the vendor's own WhatsApp with the receipt pre-filled.
 * The vendor taps send, so nothing goes through a WhatsApp Business API and no
 * template or 24h session window applies.
 *
 * Blank phone → `wa.me/?text=` (WhatsApp asks which chat). A bare 10-digit
 * number is treated as Indian. Returns null for a number that can't be valid.
 */
export function receiptWhatsappUrl(text: string, phone?: string | null): string | null {
  const encoded = encodeURIComponent(text);
  let digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return `https://wa.me/?text=${encoded}`;
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encoded}`;
}
