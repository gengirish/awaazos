import { z } from "zod";

/**
 * The store's display name (`Vendor.name`). Same limit as `stallName` in
 * `signUpSchema` (lib/zod-auth.ts), so a name accepted at sign-up can always be
 * saved again from Settings → Online store.
 *
 * Renaming never touches `Vendor.slug`: shared /s/[slug] links, printed QR codes
 * and receipt links all depend on it staying put.
 *
 * Client-safe (no Prisma).
 */
export const STORE_NAME_MAX = 120;

export const STORE_NAME_REQUIRED_MESSAGE = "Enter a store name.";
export const STORE_NAME_TOO_LONG_MESSAGE = `Store name can be at most ${STORE_NAME_MAX} characters.`;

export const storeNameSchema = z
  .string()
  .trim()
  .min(1, STORE_NAME_REQUIRED_MESSAGE)
  .max(STORE_NAME_MAX, STORE_NAME_TOO_LONG_MESSAGE);
