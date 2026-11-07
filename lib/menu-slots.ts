/**
 * Pickup / delivery slots for everyday-menu orders ("when do you want it?").
 *
 * Pure and client-safe. The seller sets a weekly pattern in Settings → Online
 * orders (`VendorSettings.menuSlots`): each rule is some weekdays and one IST
 * window, e.g. Mon–Sat 12:00–14:00. Checkout lists the concrete slots of the
 * next `SLOT_DAYS_AHEAD` days that start at least `SLOT_LEAD_MINUTES` from now;
 * the buyer picks one by its start instant, and `placeMenuOrder` re-derives the
 * slot from the rules on the server (the browser only names a start time).
 *
 * No slots configured → checkout asks no "when" and orders keep `fulfilAt` null.
 * Drop orders never use these: a drop has its own single handover window.
 *
 * No timers: slots are computed from the rules on every read.
 */
import { formatIstTime, formatRelativeIstDay, formatWindowWithDay, istToUtc } from "@/lib/drops-time";

export const MAX_MENU_SLOT_RULES = 10;
/** How many days, starting today, checkout offers. */
export const SLOT_DAYS_AHEAD = 7;
/** A slot can't be picked once it starts in less than this. */
export const SLOT_LEAD_MINUTES = 60;

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type MenuSlotRule = {
  /** IST weekdays, 0 = Sunday. */
  days: number[];
  /** "HH:MM" IST, start < end, same day. */
  start: string;
  end: string;
};

/**
 * One rule as entered, or null when it isn't valid: 1–7 weekdays (0–6), "HH:MM"
 * times, end after start. Hand-written rather than zod so the store page and
 * the board don't ship zod; `menuSlotsSchema` (lib/menu-slots-schema.ts) wraps it for the API.
 */
export function toMenuSlotRule(entry: unknown): MenuSlotRule | null {
  if (!entry || typeof entry !== "object") return null;
  const { days, start, end } = entry as Record<string, unknown>;
  if (!Array.isArray(days) || days.length < 1 || days.length > 7) return null;
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  if (typeof start !== "string" || typeof end !== "string" || !HM.test(start) || !HM.test(end)) return null;
  if (start >= end) return null;
  return { days: [...new Set(days as number[])].sort((a, b) => a - b), start, end };
}

/** The stored JSON, as rules; anything malformed is dropped rather than thrown. */
export function parseMenuSlots(raw: unknown): MenuSlotRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_MENU_SLOT_RULES)
    .map(toMenuSlotRule)
    .filter((r): r is MenuSlotRule => r !== null);
}

export type MenuSlot = {
  /** ISO start instant: what checkout posts as `slotStart`. */
  key: string;
  start: Date;
  end: Date;
};

/** IST "YYYY-MM-DD" and weekday of an instant. */
function istDay(d: Date): { ymd: string; weekday: number } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return { ymd: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay() };
}

/** Every slot a buyer can pick now, soonest first, no duplicates. */
export function upcomingMenuSlots(rules: readonly MenuSlotRule[], now: Date = new Date()): MenuSlot[] {
  const earliest = now.getTime() + SLOT_LEAD_MINUTES * 60_000;
  const byKey = new Map<string, MenuSlot>();
  for (let offset = 0; offset < SLOT_DAYS_AHEAD; offset++) {
    const { ymd, weekday } = istDay(new Date(now.getTime() + offset * DAY_MS));
    for (const rule of rules) {
      if (!rule.days.includes(weekday)) continue;
      const start = istToUtc(ymd, rule.start);
      if (start.getTime() < earliest) continue;
      const end = istToUtc(ymd, rule.end);
      const key = start.toISOString();
      const existing = byKey.get(key);
      // Two rules starting together: keep the longer window.
      if (!existing || end > existing.end) byKey.set(key, { key, start, end });
    }
  }
  return [...byKey.values()].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
}

/** The slot a posted start names, if it is still offered. */
export function findMenuSlot(rules: readonly MenuSlotRule[], key: string, now: Date = new Date()): MenuSlot | null {
  return upcomingMenuSlots(rules, now).find((s) => s.key === key) ?? null;
}

/** "Today · 12–2 pm" */
export function menuSlotLabel(slot: Pick<MenuSlot, "start" | "end">, now: Date = new Date()): string {
  return formatWindowWithDay(slot.start, slot.end, now);
}

/**
 * The handover time an order card, receipt or message shows: the slot the buyer
 * picked, a single time (demo orders), or null when none was chosen.
 */
export function orderSlotLabel(
  fulfilAt: Date | string | null | undefined,
  fulfilUntil: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!fulfilAt) return null;
  const start = new Date(fulfilAt);
  const end = fulfilUntil ? new Date(fulfilUntil) : null;
  return end ? formatWindowWithDay(start, end, now) : `${formatRelativeIstDay(start, now)} · ${formatIstTime(start)}`;
}

/** Settings summary, Monday first: "Every day", "Mon–Sat", "Fri–Sun", "Sat, Sun". */
export function slotRuleDaysLabel(days: readonly number[]): string {
  const monFirst = (d: number) => (d + 6) % 7;
  const sorted = [...new Set(days)].sort((a, b) => monFirst(a) - monFirst(b));
  if (sorted.length === 7) return "Every day";
  // A run of consecutive days reads as a range.
  const isRun = sorted.every((d, i) => i === 0 || monFirst(d) === monFirst(sorted[i - 1]) + 1);
  if (isRun && sorted.length >= 3) return `${WEEKDAY_NAMES[sorted[0]]}–${WEEKDAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(", ");
}
