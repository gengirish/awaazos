import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Server-to-server auth for /api/internal/*: the caller sends
 * `x-internal-api-key: <INTERNAL_API_KEY>`. No session, no cookie, nothing a
 * browser holds. With the env var unset (or shorter than 32 chars) every call
 * is refused, so the API is off by default.
 */
export const INTERNAL_KEY_HEADER = "x-internal-api-key";
const MIN_KEY_LENGTH = 32;

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

export function isInternalCaller(req: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY ?? "";
  if (expected.length < MIN_KEY_LENGTH) return false;
  const given = req.headers.get(INTERNAL_KEY_HEADER) ?? "";
  if (!given) return false;
  // Hash both sides so the comparison is constant-time whatever the length.
  return timingSafeEqual(digest(given), digest(expected));
}

/** Rate-limit bucket for the key in use — never the key itself. */
export function internalKeyId(): string {
  return digest(process.env.INTERNAL_API_KEY ?? "").toString("hex").slice(0, 16);
}
