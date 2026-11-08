/**
 * The store tagline (`VendorSettings.tagline`): one line under the store name
 * on /s/[slug] ("Energised crystals and malas, made in Hyderabad"), also the
 * link-preview description and a line on the share image. Seller free text,
 * so it is only ever rendered as text. Written by `PATCH /api/vendor`
 * (OWNER), edited in Settings → Online store.
 */
export const STORE_TAGLINE_MAX = 120;

export const STORE_TAGLINE_MESSAGE = `Keep the tagline between 2 and ${STORE_TAGLINE_MAX} characters, on one line.`;

/** Trimmed, inner whitespace (including newlines) collapsed; blank → null. */
export function normaliseStoreTagline(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const tagline = raw.replace(/\s+/g, " ").trim();
  return tagline === "" ? null : tagline;
}

/** A normalised tagline the store may keep (`null` is "no tagline", always fine). */
export function isValidStoreTagline(tagline: string | null): boolean {
  return tagline === null || (tagline.length >= 2 && tagline.length <= STORE_TAGLINE_MAX);
}
