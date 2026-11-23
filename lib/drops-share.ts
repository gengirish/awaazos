/**
 * WhatsApp share text for a Drop. Pure — no DOM, no network — so the vendor's
 * share button and tests build exactly the same message.
 *
 * Kept short on purpose: WhatsApp collapses long messages behind "Read more",
 * and the link preview of the drop's own link (app/s/[slug]/preorder/[dropId]/share-card)
 * carries the detail.
 */

import { formatFulfilmentWindow, formatIstTime } from "@/lib/drops-time";
import { withWhatsAppTag } from "@/lib/order-channel";

export const SHARE_MAX_ITEMS = 6;

/**
 * A drop's own link, /s/<slug>/preorder/<dropId> (docs/DROP_LINK_PLAN.md): the
 * store page showing only this pre-order, with a preview of its items. "preorder",
 * not "drop": buyers read the address.
 */
export function preorderLinkPath(slug: string, dropId: string): string {
  return `/s/${encodeURIComponent(slug)}/preorder/${encodeURIComponent(dropId)}`;
}

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

/**
 * A wa.me link whose store link carries `src=wa` (lib/order-channel.ts), so an
 * order placed from it counts as WhatsApp on /admin/metrics. Only for paths that
 * certainly open WhatsApp: the device share sheet may hand the text to any app,
 * so it keeps the plain link.
 */
export function buildTaggedWhatsAppShareUrl(text: string, storeUrl: string): string {
  return buildWhatsAppShareUrl(storeUrl ? text.split(storeUrl).join(withWhatsAppTag(storeUrl)) : text);
}

/**
 * What to hand `navigator.share`. When the message already carries the link,
 * `url` is left out: WhatsApp and other apps append `url` after `text`, so the
 * buyer would get the link twice. Apps that ignore `text` are rare enough that
 * one clean message wins.
 */
export function shareSheetData({ title, text, url }: { title: string; text: string; url: string }): ShareData {
  return url && text.includes(url) ? { title, text } : { title, text, url };
}

/**
 * The device's share sheet, else a wa.me link. A dismissed sheet (AbortError) is
 * not an error; a refused one falls through to WhatsApp. Call it from a tap.
 */
export async function shareOrOpenWhatsApp({ title, text, url }: { title: string; text: string; url: string }): Promise<void> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(shareSheetData({ title, text, url }));
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }
  window.open(buildTaggedWhatsAppShareUrl(text, url), "_blank", "noopener,noreferrer");
}
