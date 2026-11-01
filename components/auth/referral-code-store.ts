/**
 * The sign-up page's memory of a referral code (`?ref=<slug>`, lib/referral.ts).
 *
 * A seller often opens the invite link, leaves, and comes back to /sign-up
 * later without the query string, so the code is kept on the device under
 * `REFERRAL_STORAGE_KEY` for `REFERRAL_STORAGE_TTL_DAYS`. It is only the
 * referrer's public store slug, never PII.
 *
 * The rules are pure functions (tested); `syncStoredReferral` and
 * `clearStoredReferral` touch localStorage and never throw: private windows,
 * blocked site data and full quotas all read as "no code".
 */

import {
  parseReferralCode,
  REFERRAL_STORAGE_KEY,
  REFERRAL_STORAGE_TTL_DAYS,
} from "@/lib/referral";

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredReferral = { code: string; expiresAt: number };

/** The value written to storage for `code`, expiring `REFERRAL_STORAGE_TTL_DAYS` from `now`. */
export function encodeStoredReferral(code: string, now: number): string {
  const value: StoredReferral = { code, expiresAt: now + REFERRAL_STORAGE_TTL_DAYS * DAY_MS };
  return JSON.stringify(value);
}

/** The code in a stored value, or null when it is missing, malformed, invalid or expired. */
export function decodeStoredReferral(raw: string | null | undefined, now: number): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { code, expiresAt } = parsed as Partial<StoredReferral>;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return parseReferralCode(code);
}

export type ReferralResolution = {
  /** The code to send with sign-up, or null. */
  code: string | null;
  /** A new value to write to storage (a fresh code from the link), or null to leave it. */
  write: string | null;
  /** True when the stored value is unusable (expired / malformed) and should be removed. */
  clear: boolean;
};

/**
 * Which code the sign-up page uses: a valid `?ref=` wins and is (re)stored
 * with a fresh expiry; otherwise an unexpired stored code; otherwise none.
 */
export function resolveReferralCode(
  queryValue: string | null | undefined,
  storedRaw: string | null | undefined,
  now: number,
): ReferralResolution {
  const fromQuery = parseReferralCode(queryValue);
  if (fromQuery) return { code: fromQuery, write: encodeStoredReferral(fromQuery, now), clear: false };
  const fromStore = decodeStoredReferral(storedRaw, now);
  if (fromStore) return { code: fromStore, write: null, clear: false };
  return { code: null, write: null, clear: typeof storedRaw === "string" && storedRaw !== "" };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads `?ref=` against the stored code, updates storage as needed and
 * returns the code to use. Never throws.
 */
export function syncStoredReferral(
  queryValue: string | null | undefined,
  now: number = Date.now(),
  storage: StorageLike | null = browserStorage(),
): string | null {
  let storedRaw: string | null = null;
  try {
    storedRaw = storage?.getItem(REFERRAL_STORAGE_KEY) ?? null;
  } catch {
    storedRaw = null;
  }
  const result = resolveReferralCode(queryValue, storedRaw, now);
  try {
    if (result.write) storage?.setItem(REFERRAL_STORAGE_KEY, result.write);
    else if (result.clear) storage?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Storage full or blocked: the code still applies to this visit.
  }
  return result.code;
}

/** Forgets the stored code (after a successful sign-up). Never throws. */
export function clearStoredReferral(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Blocked storage has nothing we can clear.
  }
}
