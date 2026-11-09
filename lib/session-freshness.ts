/**
 * Was this session minted before the account's last password change?
 *
 * Auth.js JWT sessions are stateless, so resetting a password cannot revoke an
 * already-issued token on its own. POST /api/auth/reset-password writes
 * `User.passwordChangedAt`; every guard that reads the user (`requireVendorRole`,
 * `requirePlatformRole`, `requireUser`) compares it with the token's `iat`.
 *
 * Pure, so lib/auth.ts and lib/rbac.ts can both use it (rbac imports auth).
 * Fail-safe: only stale when BOTH timestamps are present, so accounts that
 * have never reset a password are never locked out.
 */
export function isSessionStale(passwordChangedAt: Date | null, tokenIssuedAt: number | undefined): boolean {
  if (!passwordChangedAt || typeof tokenIssuedAt !== "number") return false;
  // `iat` is seconds since epoch; allow 5s of clock skew between issuer and reader.
  return tokenIssuedAt * 1000 + 5_000 < passwordChangedAt.getTime();
}
