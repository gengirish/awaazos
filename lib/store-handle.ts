import { z } from "zod";

/**
 * The store link: `Vendor.slug`, the handle in `/s/<handle>` that goes in an
 * Instagram bio. The owner picks it at sign-up (pre-filled from the store
 * name) and can change it in Settings → Online store; nothing generates a
 * random one unless the caller sends no handle (the internal demo-store API,
 * old clients). See `lib/store-slug.ts` for that fallback.
 *
 * Rules, enforced the same way in the browser and on the server:
 * 3–40 characters, lowercase a–z, 0–9 and single hyphens, no hyphen at either
 * end, not a reserved word. `normaliseStoreHandle` turns what the owner typed
 * ("The Ember Room") into a candidate ("the-ember-room"), so the only way to
 * fail is length or a reserved word.
 *
 * Client-safe (no Prisma).
 */
export const STORE_HANDLE_MIN = 3;
export const STORE_HANDLE_MAX = 40;

/** Brand, platform and bait words a store can't claim as its link. */
export const RESERVED_STORE_HANDLES: ReadonlySet<string> = new Set([
  "awaazos",
  "awaaz",
  "admin",
  "api",
  "app",
  "www",
  "support",
  "help",
  "official",
  "login",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "settings",
  "billing",
  "demo",
  "test",
  "store",
  "stall",
  "new",
]);

export const STORE_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const STORE_HANDLE_REQUIRED_MESSAGE = "Choose a store link.";
export const STORE_HANDLE_LENGTH_MESSAGE = `Use ${STORE_HANDLE_MIN} to ${STORE_HANDLE_MAX} characters.`;
export const STORE_HANDLE_FORMAT_MESSAGE = "Only lowercase letters, numbers and single hyphens, not at the ends.";
export const STORE_HANDLE_RESERVED_MESSAGE = "That link is reserved. Try another.";
export const STORE_HANDLE_TAKEN_MESSAGE = "That link is already taken. Try another.";

/**
 * Lowercases, strips accents and turns every run of other characters into one
 * hyphen, so "Prankie's Bakery" → "prankie-s-bakery". Returns "" when nothing
 * usable is left (a name in Devanagari, say), so the owner must type one.
 */
export function normaliseStoreHandle(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, STORE_HANDLE_MAX)
    .replace(/-+$/g, "");
}

/**
 * `normaliseStoreHandle` for an input's onChange: the same cleanup, but a
 * hyphen at the end survives so the owner can type "ember-" on the way to
 * "ember-room". Apply the full normalisation on blur and submit.
 */
export function storeHandleWhileTyping(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, STORE_HANDLE_MAX);
}

/** Why `handle` can't be a store link, or null when it can. Does not know about taken ones. */
export function storeHandleProblem(handle: string): string | null {
  if (!handle) return STORE_HANDLE_REQUIRED_MESSAGE;
  if (handle.length < STORE_HANDLE_MIN || handle.length > STORE_HANDLE_MAX) return STORE_HANDLE_LENGTH_MESSAGE;
  if (!STORE_HANDLE_PATTERN.test(handle)) return STORE_HANDLE_FORMAT_MESSAGE;
  if (RESERVED_STORE_HANDLES.has(handle)) return STORE_HANDLE_RESERVED_MESSAGE;
  return null;
}

/** Accepts what the owner typed, in any case, and yields the stored lowercase handle. */
export const storeHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((handle, ctx) => {
    const problem = storeHandleProblem(handle);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

/** The link shown next to the handle field: the host without a scheme. */
export function storeLinkPrefix(host: string): string {
  return `${host}/s/`;
}
