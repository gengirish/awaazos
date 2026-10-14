/**
 * Storefront buyer auth — passwordless email magic link.
 *
 * Buyers are NOT NextAuth users. They live in `Customer` and never touch
 * User / StaffMember / lib/auth*.ts / lib/rbac.ts, so a buyer session can never
 * reach a vendor dashboard and a vendor session means nothing on a storefront.
 *
 * Invariants:
 *   - Raw tokens (login link + session cookie) are 32 random bytes, base64url.
 *     Only their SHA-256 hashes are stored; a DB read cannot mint a session.
 *   - Login tokens live 15 minutes and are single use — consumption is a
 *     conditional `updateMany` on `usedAt: null`, so two concurrent clicks
 *     cannot both win.
 *   - Sessions live 30 days in the httpOnly `awz_cust` cookie. Logout deletes
 *     the row, so a stolen cookie dies with it.
 *   - `returnTo` is always a same-origin storefront path (`safeReturnTo`).
 *   - No timers. Expired rows are swept lazily when the same customer next
 *     signs in — never on a schedule (scale-to-zero: Neon must be allowed to
 *     sleep). `getCurrentCustomer` is a single indexed read, only on a
 *     storefront page load or API call, never polled.
 *   - Customer email / phone / address are PII: never logged.
 */

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

export const CUSTOMER_SESSION_COOKIE = "awz_cust";
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CurrentCustomer = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  savedAddress: string | null;
};

// ─── Pure helpers ───────────────────────────────────────────────────

/** 32 random bytes, base64url (43 chars). */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex. Tokens carry 256 bits of entropy, so no salt/KDF is needed. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Stable, non-reversible bucket id for per-email rate limits (never the raw email). */
export function emailRateKey(email: string): string {
  return hashToken(`rl:${normaliseEmail(email)}`).slice(0, 32);
}

export function loginTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LOGIN_TOKEN_TTL_MS);
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/** True when a login token row may still be redeemed. */
export function isLoginTokenUsable(
  row: { expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return row.usedAt === null && row.expiresAt.getTime() > now.getTime();
}

/**
 * Open-redirect guard. Accepts only a same-origin relative path under `/s/`.
 * Rejects protocol-relative (`//evil`), backslashes (browsers treat `/\evil`
 * as `//evil`), schemes, control characters, and anything that does not
 * resolve back onto our own origin. Returns null when unsafe.
 */
export function safeReturnTo(path: unknown): string | null {
  if (typeof path !== "string") return null;
  if (path.length === 0 || path.length > 512) return null;
  if (!path.startsWith("/s/")) return null;
  if (path.includes("//")) return null;
  if (path.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(path)) return null;
  // Percent-encoded slash/backslash could be decoded into `//` by a proxy.
  if (/%(2f|5c)/i.test(path)) return null;

  const base = "https://awaazos.invalid";
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  if (!url.pathname.startsWith("/s/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Same as safeReturnTo with a fallback. */
export function returnToOr(path: unknown, fallback: string): string {
  return safeReturnTo(path) ?? fallback;
}

/**
 * Origin for links in outgoing email. Env-only, never the request `Host`
 * header — trusting Host would let an attacker request a link for a victim's
 * email that points at the attacker's domain (host header injection).
 * Mirrors resetLinkBase() in app/api/auth/forgot-password.
 */
export function customerLinkBase(): string {
  const explicit = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = explicit ?? (vercel ? `https://${vercel}` : undefined) ?? "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

// ─── DB-backed operations ───────────────────────────────────────────

/**
 * Find-or-create the Customer for this email (normalised) and mint a login
 * token. Returns the RAW token — for the email link only, never log it.
 * Creating on request is deliberate (uniform work whether or not the email is
 * known); the login route rate-limits it per IP and per email. Sweeps this
 * customer's dead tokens while we're here.
 */
export async function createLoginToken(
  email: string,
  returnTo: string | null,
  now: Date = new Date(),
): Promise<{ rawToken: string; expiresAt: Date; customerId: string }> {
  const normalised = normaliseEmail(email);
  const customer = await prisma.customer.upsert({
    where: { email: normalised },
    create: { email: normalised },
    update: {},
    select: { id: true },
  });

  const rawToken = generateRawToken();
  const expiresAt = loginTokenExpiry(now);
  await prisma.customerLoginToken.deleteMany({
    where: { customerId: customer.id, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  });
  await prisma.customerLoginToken.create({
    data: {
      customerId: customer.id,
      tokenHash: hashToken(rawToken),
      returnTo: safeReturnTo(returnTo),
      expiresAt,
    },
  });
  return { rawToken, expiresAt, customerId: customer.id };
}

export type ConsumeResult =
  | { ok: true; customerId: string; returnTo: string | null }
  | { ok: false; returnTo: string | null };

/**
 * Redeem a login token. Single use: the conditional update means exactly one
 * caller can flip `usedAt` from null. On failure still reports the stored
 * `returnTo` (when the row exists) so the buyer lands back on the store.
 */
export async function consumeLoginToken(rawToken: string, now: Date = new Date()): Promise<ConsumeResult> {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) {
    return { ok: false, returnTo: null };
  }
  const tokenHash = hashToken(rawToken);
  const row = await prisma.customerLoginToken.findUnique({
    where: { tokenHash },
    select: { id: true, customerId: true, returnTo: true },
  });
  if (!row) return { ok: false, returnTo: null };
  const returnTo = safeReturnTo(row.returnTo);

  const claimed = await prisma.customerLoginToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return { ok: false, returnTo };
  return { ok: true, customerId: row.customerId, returnTo };
}

/** Create a session row; returns the RAW cookie value and expiry. */
export async function createSession(
  customerId: string,
  now: Date = new Date(),
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = sessionExpiry(now);
  await prisma.customerSession.deleteMany({ where: { customerId, expiresAt: { lt: now } } });
  await prisma.customerSession.create({
    data: { customerId, tokenHash: hashToken(rawToken), expiresAt },
  });
  return { rawToken, expiresAt };
}

/** Look up a session by raw cookie value. */
export async function customerFromSessionToken(
  rawToken: string | undefined | null,
  now: Date = new Date(),
): Promise<CurrentCustomer | null> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 128) return null;
  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      expiresAt: true,
      customer: { select: { id: true, email: true, name: true, phone: true, savedAddress: true } },
    },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
  return session.customer;
}

/**
 * The signed-in buyer for this request, or null. One indexed read; call only
 * from storefront pages / storefront API routes.
 */
export async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
  const raw = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return await customerFromSessionToken(raw);
  } catch (err) {
    // A DB blip must not break the public page — treat as signed out.
    console.error(
      JSON.stringify({
        event: "customer_session_lookup_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return null;
  }
}

/** Delete the current session row (if any). The caller clears the cookie. */
export async function destroySession(): Promise<void> {
  const raw = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!raw || raw.length > 128) return;
  await prisma.customerSession.deleteMany({ where: { tokenHash: hashToken(raw) } });
}
