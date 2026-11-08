import { normaliseStoreHandle, STORE_HANDLE_MAX } from "@/lib/store-handle";

/**
 * Fallback for callers that send no store handle (the internal demo-store API,
 * clients older than the "Store link" field at sign-up):
 * "<name, url-safe, ≤ 40 chars>-<4 random chars>", e.g. "prankie-s-bakery-001x".
 * Callers retry on a P2002 slug collision. An owner-chosen handle goes through
 * `storeHandleSchema` in `lib/store-handle.ts` instead and gets no suffix.
 */

export function slugBase(stallName: string): string {
  // Leave room for "-" + 4 characters so the result still fits the handle rules.
  const base = normaliseStoreHandle(stallName)
    .slice(0, STORE_HANDLE_MAX - 5)
    .replace(/-+$/, "");
  return base || "stall";
}

export function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return out;
}

export function newVendorSlug(stallName: string): string {
  return `${slugBase(stallName)}-${randomSuffix()}`;
}
