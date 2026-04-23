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
};

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

  lines.push(input.receiptFooter?.trim() || "Thanks for visiting!");
  lines.push("Powered by AwaazOS 🇮🇳");

  return lines.join("\n");
}
