/**
 * Orders-board pass: lets the board's new-order check run without Postgres.
 *
 * The board polls `/api/storefront-orders/signal` for the per-vendor Upstash
 * counter (lib/drops-signal.ts). A full `requireVendorRole` there reads the
 * user and its memberships from Postgres on every tick, which would keep Neon
 * awake for as long as a board is open (global scale-to-zero rule). Instead,
 * every Postgres-checked board load (the /orders page and
 * GET /api/storefront-orders) mints this pass, and the signal route accepts it
 * together with the JWT session (`auth()` decodes the cookie; no DB read).
 *
 * Rules:
 * - HMAC-SHA256 over `vendorId.userId.exp`, keyed off AUTH_SECRET with its own
 *   label, compared in constant time. The pass grants one thing only: reading
 *   that vendor's counter, a bare number with no order data.
 * - Bound to the signed-in user: the route rejects a pass whose userId is not
 *   the session's, so a pass on its own is useless.
 * - Lives `BOARD_PASS_TTL_MS` (12 h). A staff member removed from a store can
 *   read its counter until then; every request that returns orders still runs
 *   the full role check. Each board refresh hands out a fresh pass.
 *
 * Server only (node:crypto).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const BOARD_PASS_TTL_MS = 12 * 60 * 60 * 1000;

/** Request header carrying the pass. A header, not a query param, so it stays out of access logs. */
export const BOARD_PASS_HEADER = "x-board-pass";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret).update("awaazos:board-pass:v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function mintBoardPass(args: { vendorId: string; userId: string }, now: number = Date.now()): string {
  const exp = Math.floor((now + BOARD_PASS_TTL_MS) / 1000);
  const payload = `${args.vendorId}.${args.userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** The pass's vendor and user when it is genuine and unexpired, else null. Never throws on bad input. */
export function verifyBoardPass(
  pass: string | null | undefined,
  now: number = Date.now(),
): { vendorId: string; userId: string } | null {
  if (!pass || pass.length > 300) return null;
  const parts = pass.split(".");
  if (parts.length !== 4) return null;
  const [vendorId, userId, expRaw, sig] = parts;
  if (!ID_PATTERN.test(vendorId) || !ID_PATTERN.test(userId) || !/^\d{1,12}$/.test(expRaw)) return null;

  const expected = Buffer.from(sign(`${vendorId}.${userId}.${expRaw}`), "base64url");
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  if (Number(expRaw) * 1000 <= now) return null;
  return { vendorId, userId };
}
