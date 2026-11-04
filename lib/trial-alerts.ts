/**
 * When a seller hears that their free trial is ending, or that a buyer was just
 * turned away. Pure and client-safe; sending is in lib/trial-alerts-server.ts.
 *
 * Billing itself stays lazy (lib/plan.ts): these alerts never write a plan, a
 * lock or a date. They only tell the seller what `billingAccess` already says.
 *
 *   first   5 to 2 IST days before `trialEndsAt`, once
 *   final   the day before and the last day, once
 *   locked  a buyer's order was refused (`orders_paused`), at most once a day
 *
 * A reminder's key carries the trial's end date, so an extension (free access
 * by hand, a referral reward) earns the seller new reminders for the new date.
 * Days are IST calendar days: the job runs in the morning, and a trial ending
 * tomorrow evening must read "tomorrow", not "in 2 days".
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST days before the end of the trial at which the first reminder goes out. */
export const TRIAL_REMINDER_FIRST_DAYS = 5;
/** IST days before the end of the trial at which the last reminder goes out. */
export const TRIAL_REMINDER_FINAL_DAYS = 1;

/** Longer than any reminder window, so a sent reminder can't expire and repeat. */
export const TRIAL_REMINDER_KEY_TTL_SECONDS = 40 * 24 * 60 * 60;
export const STORE_LOCKED_KEY_TTL_SECONDS = 24 * 60 * 60;

export type TrialReminderKind = "first" | "final";

function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** IST calendar days from `now` to `endsAt`: 0 = today, 1 = tomorrow. */
export function istDaysUntil(endsAt: Date, now: Date): number {
  return istDayNumber(endsAt) - istDayNumber(now);
}

/** The reminder this trial is in the window for, or null. */
export function trialReminderDue(endsAt: Date, now: Date): TrialReminderKind | null {
  if (endsAt.getTime() <= now.getTime()) return null;
  const days = istDaysUntil(endsAt, now);
  if (days <= TRIAL_REMINDER_FINAL_DAYS) return "final";
  return days <= TRIAL_REMINDER_FIRST_DAYS ? "first" : null;
}

/** "today" | "tomorrow" | "in 3 days". */
export function trialEndsPhrase(daysLeft: number): string {
  if (daysLeft <= 0) return "today";
  return daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
}

export function trialReminderKey(vendorId: string, kind: TrialReminderKind, endsAt: Date): string {
  return `trial-alert:${vendorId}:${kind}:${endsAt.toISOString()}`;
}

export function storeLockedKey(vendorId: string): string {
  return `store-locked-alert:${vendorId}`;
}
