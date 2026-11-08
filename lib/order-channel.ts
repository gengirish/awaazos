/**
 * Where a storefront order came from, so /admin/metrics can show whether
 * Instagram really brings orders. Pure and client-safe.
 *
 * An order counts as Instagram when either is true at placement:
 *   - the buyer is in Instagram's in-app browser (its user agent says so), which
 *     catches a plain bio link with no tag;
 *   - the store page was opened through a link tagged `?src=ig`, which catches a
 *     buyer who moved to Chrome or Safari, as long as they order from that page.
 *
 * Only links the seller is told to put on Instagram get the tag (the setup
 * card's bio link, the story's Link sticker). The general "Copy link" stays
 * clean, because it also ends up in WhatsApp. Null means "not known to be
 * Instagram", not "not Instagram". The user agent itself is never stored, and
 * none of this reaches the buyer or the seller.
 */

export const INSTAGRAM_SRC = "ig";

export type OrderChannel = "instagram";

/** Adds the Instagram tag to a store link, keeping any query or hash it has. */
export function withInstagramTag(url: string): string {
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}src=${INSTAGRAM_SRC}${hash}`;
}

/** The `src` to post with an order, from the store page's query string. Anything unknown is dropped. */
export function orderSrcFromSearch(search: string): typeof INSTAGRAM_SRC | undefined {
  return new URLSearchParams(search).get("src") === INSTAGRAM_SRC ? INSTAGRAM_SRC : undefined;
}

export function orderChannelFor(input: { src?: string | null; userAgent?: string | null }): OrderChannel | null {
  if (input.src === INSTAGRAM_SRC) return "instagram";
  return /\bInstagram\b/i.test(input.userAgent ?? "") ? "instagram" : null;
}
