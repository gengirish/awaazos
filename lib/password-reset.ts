import crypto from "node:crypto";

/** Reset links are short-lived by design. */
export const RESET_TOKEN_TTL_MINUTES = 30;

/** Opaque, URL-safe, 256 bits of entropy. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Tokens are stored hashed so a database read cannot be replayed as a
 * password reset. SHA-256 (not bcrypt) is correct here: the input is
 * already high-entropy, so there is nothing to brute-force, and lookup
 * must be a fast indexed equality match.
 */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function resetTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}
