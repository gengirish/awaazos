import { describe, expect, it } from "vitest";

import {
  clearStoredReferral,
  decodeStoredReferral,
  encodeStoredReferral,
  resolveReferralCode,
  syncStoredReferral,
} from "@/components/auth/referral-code-store";
import { REFERRAL_STORAGE_KEY, REFERRAL_STORAGE_TTL_DAYS } from "@/lib/referral";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 1, 6, 30);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function throwingStorage() {
  const boom = () => {
    throw new Error("SecurityError");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

describe("encodeStoredReferral / decodeStoredReferral", () => {
  it("round-trips until the TTL passes", () => {
    const raw = encodeStoredReferral("sam-store", NOW);
    expect(decodeStoredReferral(raw, NOW)).toBe("sam-store");
    expect(decodeStoredReferral(raw, NOW + REFERRAL_STORAGE_TTL_DAYS * DAY_MS - 1)).toBe("sam-store");
    expect(decodeStoredReferral(raw, NOW + REFERRAL_STORAGE_TTL_DAYS * DAY_MS)).toBeNull();
  });

  it("rejects missing, malformed and invalid values", () => {
    expect(decodeStoredReferral(null, NOW)).toBeNull();
    expect(decodeStoredReferral("", NOW)).toBeNull();
    expect(decodeStoredReferral("not json", NOW)).toBeNull();
    expect(decodeStoredReferral("null", NOW)).toBeNull();
    expect(decodeStoredReferral(JSON.stringify({ code: "sam-store" }), NOW)).toBeNull();
    expect(decodeStoredReferral(JSON.stringify({ code: "Bad Code", expiresAt: NOW + DAY_MS }), NOW)).toBeNull();
    expect(decodeStoredReferral(JSON.stringify({ code: 42, expiresAt: NOW + DAY_MS }), NOW)).toBeNull();
  });
});

describe("resolveReferralCode", () => {
  it("prefers a valid ?ref= and stores it with a fresh expiry", () => {
    const old = encodeStoredReferral("old-store", NOW - DAY_MS);
    const r = resolveReferralCode(" Sam-Store ", old, NOW);
    expect(r.code).toBe("sam-store");
    expect(r.write).toBe(encodeStoredReferral("sam-store", NOW));
    expect(r.clear).toBe(false);
  });

  it("falls back to an unexpired stored code when ?ref= is missing or invalid", () => {
    const stored = encodeStoredReferral("sam-store", NOW - DAY_MS);
    expect(resolveReferralCode(null, stored, NOW)).toEqual({ code: "sam-store", write: null, clear: false });
    expect(resolveReferralCode("x", stored, NOW).code).toBe("sam-store");
    expect(resolveReferralCode("<script>", stored, NOW).code).toBe("sam-store");
  });

  it("clears an expired stored code and returns none", () => {
    const expired = encodeStoredReferral("sam-store", NOW - (REFERRAL_STORAGE_TTL_DAYS + 1) * DAY_MS);
    expect(resolveReferralCode(null, expired, NOW)).toEqual({ code: null, write: null, clear: true });
    expect(resolveReferralCode(null, null, NOW)).toEqual({ code: null, write: null, clear: false });
  });
});

describe("syncStoredReferral / clearStoredReferral", () => {
  it("writes, reads back and clears through storage", () => {
    const s = memoryStorage();
    expect(syncStoredReferral("sam-store", NOW, s)).toBe("sam-store");
    expect(s.data.has(REFERRAL_STORAGE_KEY)).toBe(true);
    expect(syncStoredReferral(null, NOW + DAY_MS, s)).toBe("sam-store");
    clearStoredReferral(s);
    expect(s.data.has(REFERRAL_STORAGE_KEY)).toBe(false);
    expect(syncStoredReferral(null, NOW, s)).toBeNull();
  });

  it("removes an expired value", () => {
    const s = memoryStorage({ [REFERRAL_STORAGE_KEY]: encodeStoredReferral("sam-store", NOW - 40 * DAY_MS) });
    expect(syncStoredReferral(null, NOW, s)).toBeNull();
    expect(s.data.has(REFERRAL_STORAGE_KEY)).toBe(false);
  });

  it("never throws when storage is blocked, and still uses ?ref=", () => {
    expect(syncStoredReferral("sam-store", NOW, throwingStorage())).toBe("sam-store");
    expect(syncStoredReferral(null, NOW, throwingStorage())).toBeNull();
    expect(syncStoredReferral("sam-store", NOW, null)).toBe("sam-store");
    expect(() => clearStoredReferral(throwingStorage())).not.toThrow();
  });
});
