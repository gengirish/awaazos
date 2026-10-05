/**
 * WhatsApp share text for a Drop. Pure — no DOM, no network — so the vendor's
 * share button and tests build exactly the same message.
 *
 * Kept short on purpose: WhatsApp collapses long messages behind "Read more",
 * and the link preview (app/s/[slug]/opengraph-image.tsx) carries the detail.
 */

import { formatFulfilmentWindow, formatIstTime } from "@/lib/drops-time";

export const SHARE_MAX_ITEMS = 6;

export type DropShareInput = {
  vendorName: string;
  dropTitle: string;
  closesAt: Date;
  fulfilmentStartsAt: Date;
  fulfilmentEndsAt: Date;
  fulfilmentMode: "DELIVERY" | "PICKUP" | "BOTH";
  itemNames: string[];
  url: string;
};

const MODE_LINE: Record<DropShareInput["fulfilmentMode"], string> = {
  DELIVERY: "🚚 Delivery",
  PICKUP: "📍 Pickup",
  BOTH: "🚚 Delivery or pickup",
};

/** "Fri" in IST. */
function istWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
}

/** "Ragi laddu · Thepla · Banana bread", capped at SHARE_MAX_ITEMS + "and N more". */
export function formatShareItemList(itemNames: string[]): string {
  const names = itemNames.map((n) => n.trim()).filter(Boolean);
  const shown = names.slice(0, SHARE_MAX_ITEMS).join(" · ");
  const rest = names.length - SHARE_MAX_ITEMS;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

export function buildDropShareText(input: DropShareInput): string {
  const lines = [`🍪 ${input.dropTitle.trim()} by ${input.vendorName.trim()}`];
  const items = formatShareItemList(input.itemNames);
  if (items) lines.push(items);
  lines.push(
    `${MODE_LINE[input.fulfilmentMode]} ${formatFulfilmentWindow(input.fulfilmentStartsAt, input.fulfilmentEndsAt)}`,
  );
  lines.push(`⏰ Order by ${istWeekday(input.closesAt)} ${formatIstTime(input.closesAt)}`);
  lines.push(`Order here: ${input.url}`);
  return lines.join("\n");
}

/** Universal WhatsApp share link — opens the contact picker with `text` prefilled. */
export function buildWhatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
