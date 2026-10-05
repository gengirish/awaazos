import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// Pure helpers only — keep Prisma (and lib/env's boot checks) out of the test.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));

import {
  LOGIN_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  emailRateKey,
  generateRawToken,
  hashToken,
  isLoginTokenUsable,
  loginTokenExpiry,
  normaliseEmail,
  safeReturnTo,
  sessionCookieOptions,
  sessionExpiry,
} from "@/lib/customer-auth";

describe("safeReturnTo", () => {
  it.each([
    ["/s/meena-kitchen-ab12", "/s/meena-kitchen-ab12"],
    ["/s/meena-kitchen-ab12/account", "/s/meena-kitchen-ab12/account"],
    ["/s/x/account?tab=orders#top", "/s/x/account?tab=orders#top"],
  ])("accepts %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/s/x",
    "https://evil.com",
    "https://evil.com/s/x",
    "javascript:alert(1)",
    "/\\evil",
    "/s/\\evil",
    "\\\\evil.com",
    "/s//evil.com",
    "/dashboard",
    "/api/s/customer/logout",
    "s/x",
    "",
    " /s/x",
    "/s/x\n",
    "/s/x\tfoo",
    "/s/%2f%2fevil.com",
    "/s/%5cevil",
    "/s/../dashboard",
    "/s/x/../../settings",
    "/s/" + "a".repeat(600),
  ])("rejects %j", (input) => {
    expect(safeReturnTo(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(42)).toBeNull();
    expect(safeReturnTo({ toString: () => "/s/x" })).toBeNull();
  });
});

describe("tokens and hashing", () => {
  it("generates 32-byte base64url tokens", () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(generateRawToken()).not.toBe(t);
  });

  it("hashes with SHA-256 hex and never returns the raw token", () => {
    const t = generateRawToken();
    const h = hashToken(t);
    expect(h).toBe(createHash("sha256").update(t).digest("hex"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken(t)).toBe(h);
  });

  it("normalises email and buckets rate limits without the raw address", () => {
    expect(normaliseEmail("  Priya@Example.COM ")).toBe("priya@example.com");
    const k = emailRateKey("Priya@Example.com");
    expect(k).toBe(emailRateKey(" priya@example.com"));
    expect(k).not.toContain("priya");
    expect(k).toHaveLength(32);
  });
});

describe("TTL logic", () => {
  const now = new Date("2026-10-05T10:00:00Z");

  it("login token lives 15 minutes, session 30 days", () => {
    expect(LOGIN_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(loginTokenExpiry(now).toISOString()).toBe("2026-10-05T10:15:00.000Z");
    expect(sessionExpiry(now).toISOString()).toBe("2026-11-04T10:00:00.000Z");
  });

  it("login token is usable only unused and before expiry", () => {
    const expiresAt = loginTokenExpiry(now);
    expect(isLoginTokenUsable({ expiresAt, usedAt: null }, now)).toBe(true);
    expect(isLoginTokenUsable({ expiresAt, usedAt: now }, now)).toBe(false);
    expect(isLoginTokenUsable({ expiresAt, usedAt: null }, expiresAt)).toBe(false);
    expect(isLoginTokenUsable({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() + 1))).toBe(false);
  });

  it("session cookie is httpOnly, lax, root path", () => {
    const opts = sessionCookieOptions(now);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", expires: now });
  });
});
