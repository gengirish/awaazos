/**
 * Free access granted by a platform admin (`/admin/vendors`). Pure and
 * client-safe: the form previews with it, the route validates with it.
 *
 * There is no separate "comped" state. A grant moves `Vendor.trialEndsAt`, so
 * the vendor is simply on the free trial for longer (lib/plan.ts): STARTER
 * limits, no lock, and subscribing early defers the first charge to that date
 * (create-subscription). Never write `plan` / `planExpiresAt` for this — those
 * belong to the subscription path (lib/subscription-store.ts).
 *
 * Dates are IST calendar days. "Free until 14/04/2027" is stored as 23:59 IST
 * on that day, so the vendor's billing page shows the date the admin picked.
 */
import { istToUtc, utcToIstParts } from "@/lib/drops-time";

/** Furthest a grant may reach from today. */
export const FREE_ACCESS_MAX_MONTHS = 24;

/** One-tap choices in the admin form. */
export const FREE_ACCESS_PRESET_MONTHS = [1, 3, 6, 12] as const;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's IST calendar day as "YYYY-MM-DD". */
export function istTodayYmd(now: Date = new Date()): string {
  return utcToIstParts(now).ymd;
}

/**
 * "2026-10-14" + 6 → "2027-04-14". A day the target month lacks clamps to its
 * last day ("2026-08-31" + 6 → "2027-02-28").
 */
export function addMonthsYmd(ymd: string, months: number): string {
  const m = YMD.exec(ymd);
  if (!m || !Number.isInteger(months)) throw new Error(`Invalid date or months: ${ymd} ${months}`);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** "2027-04-14" → "14/04/2027" (DD/MM/YYYY), for showing a picked day back. */
export function formatYmd(ymd: string): string {
  const m = YMD.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

/** Last day a grant made today may name. */
export function freeAccessMaxYmd(now: Date = new Date()): string {
  return addMonthsYmd(istTodayYmd(now), FREE_ACCESS_MAX_MONTHS);
}

export type FreeUntilResult =
  | { ok: true; endsAt: Date }
  | { ok: false; error: "invalid_date" | "in_past" | "too_far" };

/**
 * "YYYY-MM-DD" (IST) → the `trialEndsAt` instant, 23:59 IST that day. Today is
 * the earliest day allowed: a past date would lock the vendor on the spot.
 */
export function parseFreeUntil(ymd: string, now: Date = new Date()): FreeUntilResult {
  let endsAt: Date;
  try {
    endsAt = istToUtc(ymd, "23:59");
  } catch {
    return { ok: false, error: "invalid_date" };
  }
  // Same-format ISO days compare correctly as strings.
  if (ymd < istTodayYmd(now)) return { ok: false, error: "in_past" };
  if (ymd > freeAccessMaxYmd(now)) return { ok: false, error: "too_far" };
  return { ok: true, endsAt };
}
