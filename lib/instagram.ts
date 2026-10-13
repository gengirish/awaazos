/**
 * The vendor's Instagram handle, shown on the public storefront
 * (`VendorSettings.instagramHandle`). Pure string work, safe in client
 * components. Stored bare and lower-case: no "@", no URL.
 */

export const INSTAGRAM_HANDLE_MESSAGE =
  "Enter your Instagram username: letters, numbers, dots and underscores, up to 30 characters.";

// Instagram's own username rules.
const HANDLE = /^[a-z0-9._]{1,30}$/;
const PROFILE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#]+)\/?(?:[?#].*)?$/i;

/**
 * What a vendor types ("@Ammas.Kitchen", "instagram.com/ammas.kitchen/?hl=en")
 * → the stored handle ("ammas.kitchen"). "" for blank input (clears the
 * field), null when it is not a valid username.
 */
export function normaliseInstagramHandle(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const fromUrl = PROFILE_URL.exec(value);
  const handle = (fromUrl ? fromUrl[1] : value).replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

/** Profile link for a stored handle, or null when the stored value is not a usable handle. */
export function instagramProfileUrl(handle: string | null | undefined): string | null {
  if (!handle || !HANDLE.test(handle)) return null;
  return `https://www.instagram.com/${handle}/`;
}
