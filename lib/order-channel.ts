/**
 * Where a storefront order (or a store page view) came from, so /admin/metrics
 * can show which channel really brings orders. Pure and client-safe.
 *
 *   - "instagram": the buyer is in Instagram's in-app browser (its user agent
 *     says so), which catches a plain bio link with no tag; or the store page
 *     was opened through a link tagged `?src=ig`, which catches a buyer who
 *     moved to Chrome or Safari, as long as they order from that page.
 *   - "whatsapp": the page was opened through a link tagged `?src=wa`. WhatsApp
 *     opens links in the phone's own browser, so there is no user agent to
 *     read; only the seller's explicit WhatsApp shares carry the tag.
 *   - "facebook": Facebook's or Messenger's in-app browser (user agent).
 *
 * Only links the seller is told to put on Instagram get the ig tag (the setup
 * card's bio link, the story's Link sticker), and only wa.me shares get the wa
 * tag. The general "Copy link" stays clean, because it ends up anywhere. Null
 * means "not known", not "direct". The user agent itself is never stored, and
 * none of this reaches the buyer or the seller.
 */

export const INSTAGRAM_SRC = "ig";
export const WHATSAPP_SRC = "wa";
export const ORDER_SRCS = [INSTAGRAM_SRC, WHATSAPP_SRC] as const;
export type OrderSrc = (typeof ORDER_SRCS)[number];

export type OrderChannel = "instagram" | "whatsapp" | "facebook";

/** Adds `src=<tag>` to a store link, keeping any query or hash it has. */
export function withSrcTag(url: string, src: OrderSrc): string {
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}src=${src}${hash}`;
}

/** Adds the Instagram tag to a store link, keeping any query or hash it has. */
export function withInstagramTag(url: string): string {
  return withSrcTag(url, INSTAGRAM_SRC);
}

/** Adds the WhatsApp tag to a store link, keeping any query or hash it has. */
export function withWhatsAppTag(url: string): string {
  return withSrcTag(url, WHATSAPP_SRC);
}

/** A known `src` value, or undefined. Anything unknown is dropped, never rejected. */
export function parseOrderSrc(value: string | null | undefined): OrderSrc | undefined {
  return (ORDER_SRCS as readonly string[]).includes(value ?? "") ? (value as OrderSrc) : undefined;
}

/** The `src` to post with an order, from the store page's query string. Anything unknown is dropped. */
export function orderSrcFromSearch(search: string): OrderSrc | undefined {
  return parseOrderSrc(new URLSearchParams(search).get("src"));
}

const INSTAGRAM_UA = /\bInstagram\b/i;
/** Facebook (FBAN/FBAV, FB_IAB on Android) and Messenger (FBAN/MessengerForiOS). */
const FACEBOOK_UA = /\bFB(AN|AV|_IAB|IOS|4A)\b/;

export function orderChannelFor(input: { src?: string | null; userAgent?: string | null }): OrderChannel | null {
  if (input.src === INSTAGRAM_SRC) return "instagram";
  if (input.src === WHATSAPP_SRC) return "whatsapp";
  const ua = input.userAgent ?? "";
  if (INSTAGRAM_UA.test(ua)) return "instagram";
  return FACEBOOK_UA.test(ua) ? "facebook" : null;
}
