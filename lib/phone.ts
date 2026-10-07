/**
 * Indian mobile helpers shared by client and server. Pure string work — no
 * libphonenumber-js here, so it stays cheap to import from client components.
 * Strict validation for sign-up lives in lib/zod-auth.ts.
 */

/** "98765 43210" / "+91 98765-43210" / "919876543210" → "+919876543210"; empty stays empty; anything else as typed. */
export function normaliseIndianMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return raw.trim();
}

/** "+919876543210" → "98765 43210"; anything else as stored. */
export function formatIndianMobile(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `${m[1]} ${m[2]}` : e164;
}

/** Last 4 digits only — the most a log line or CSV export may carry (PII rule). */
export function lastFourDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}
