import { createHash } from "node:crypto";

import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

/**
 * Link-preview cards for store and product links (what WhatsApp and Instagram show
 * when a seller shares /s/<slug> or /s/<slug>/p/<itemId>).
 *
 * Why these aren't `opengraph-image.tsx` files: Next serves a file-convention image
 * at a URL whose hash comes from the source file, never the store's data, with
 * `Cache-Control: public, immutable, max-age=31536000`. WhatsApp and Meta keep the
 * first card they fetch for that URL, so a seller who changed products kept sharing
 * the old card. Here:
 *
 * 1. The page's `og:image` carries `?v=<hash of what the card draws>`, so a changed
 *    card is a new URL that no crawler has cached.
 * 2. The image route ignores `v` and always draws the current card (an older page
 *    copy never gets a 404), with a 5-minute cache instead of a year.
 *
 * The version is computed from data the page already loaded: no extra query.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARD_ALT = `Order on ${BRAND_NAME}`;
export const SHARE_CARD_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

/** 12 hex chars of sha256 over the card's inputs. Only changes what URL crawlers see. */
export function shareCardVersion(inputs: unknown): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 12);
}

function withVersion(path: string, version?: string): string {
  return version ? `${path}?v=${version}` : path;
}

export function storeShareCardPath(slug: string, version?: string): string {
  return withVersion(`/s/${encodeURIComponent(slug)}/share-card`, version);
}

export function productShareCardPath(slug: string, itemId: string, version?: string): string {
  return withVersion(`/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(itemId)}/share-card`, version);
}

/** The `openGraph.images` / `twitter` metadata for one card URL. */
export function shareCardMetadata(
  url: string,
  text: { title: string; description?: string },
): Pick<Metadata, "openGraph" | "twitter"> {
  const image = { url, ...SHARE_CARD_SIZE, alt: SHARE_CARD_ALT, type: "image/png" };
  return {
    openGraph: { ...text, type: "website", images: [image] },
    twitter: { card: "summary_large_image", ...text, images: [image] },
  };
}
