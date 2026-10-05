import { formatINR } from "@/lib/currency";

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

function formatReceiptDateTimeIst(createdAt: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(createdAt);
}

/**
 * Plain-text WhatsApp body (Markdown-style asterisks for bold on WhatsApp).
 */
export function formatWhatsAppReceiptMessage(input: ReceiptMessageInput): string {
  const dateLine = formatReceiptDateTimeIst(input.createdAt);
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
