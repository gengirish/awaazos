/**
 * IST display formatting (store UTC, display IST — see india-locale rule).
 * For @db.Date calendar keys use lib/billing-period.ts; for Drop scheduling
 * conversions use lib/drops-time.ts.
 */

const IST = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "05/10/2026" (DD/MM/YYYY) in IST. */
export function formatIstDate(d: Date): string {
  return dateFmt.format(d);
}

/** "05/10/2026, 17:30" (DD/MM/YYYY, 24h) in IST. Accepts an ISO string for client props. */
export function formatIstDateTime(value: Date | string): string {
  return dateTimeFmt.format(value instanceof Date ? value : new Date(value));
}
