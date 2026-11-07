/**
 * IST wall-clock ⇄ UTC for Drop scheduling.
 *
 * A home cook thinks "order by 9pm Friday, delivery 5–8pm Saturday" in IST.
 * We store UTC instants and the cooking day as an `@db.Date` (midnight-UTC of
 * the IST calendar day — same convention as lib/billing-period.ts).
 *
 * IST has no DST, so a fixed +05:30 offset is exact.
 */

const IST = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "2026-10-05" + "17:30" (IST) → UTC Date. Throws on malformed input. */
export function istToUtc(ymd: string, hm: string): Date {
  if (!YMD.test(ymd) || !HM.test(hm)) throw new Error(`Invalid IST date/time: ${ymd} ${hm}`);
  const asIfUtc = Date.parse(`${ymd}T${hm}:00.000Z`);
  // Date.parse silently rolls impossible days over ("2026-02-30" → 2 Mar), so
  // require the parsed calendar day to match what was asked for.
  if (Number.isNaN(asIfUtc) || new Date(asIfUtc).toISOString().slice(0, 10) !== ymd) {
    throw new Error(`Invalid IST date/time: ${ymd} ${hm}`);
  }
  return new Date(asIfUtc - IST_OFFSET_MS);
}

/** "2026-10-05" → @db.Date value (midnight UTC of that calendar day). */
export function ymdToDbDate(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (!YMD.test(ymd) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) {
    throw new Error(`Invalid date: ${ymd}`);
  }
  return d;
}

/** @db.Date value → "2026-10-05". */
export function dbDateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC instant → { ymd, hm } in IST, for pre-filling edit forms. */
export function utcToIstParts(d: Date): { ymd: string; hm: string } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS).toISOString();
  return { ymd: shifted.slice(0, 10), hm: shifted.slice(11, 16) };
}

/** "5:30 pm" in IST. */
export function formatIstTime(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** "05/10/2026" (DD/MM/YYYY, per india-locale rule) in IST. */
export { formatIstDate } from "@/lib/datetime";

/** "Sat, 5 Oct" in IST — friendly label for storefront headings and share text. */
export function formatIstDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** @db.Date (cooking day) → "Sat, 5 Oct". The value is midnight UTC, so format in UTC. */
export function formatDropDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** "Sat, 5 Oct · 5:00 pm – 8:00 pm" */
export function formatFulfilmentWindow(start: Date, end: Date): string {
  return `${formatIstDayLabel(start)} · ${formatIstTime(start)} – ${formatIstTime(end)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** IST wall clock of an instant, by arithmetic (no ICU, so every runtime prints the same). */
function istClock(d: Date): { ymd: string; weekday: number; day: number; month: number; h: number; m: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    ymd: s.toISOString().slice(0, 10),
    weekday: s.getUTCDay(),
    day: s.getUTCDate(),
    month: s.getUTCMonth(),
    h: s.getUTCHours(),
    m: s.getUTCMinutes(),
  };
}

function clockTime(h: number, m: number, withMeridiem: boolean): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const base = m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
  return withMeridiem ? `${base} ${h < 12 ? "am" : "pm"}` : base;
}

/**
 * The day an instant falls on, relative to `now` (IST): "Today", "Tomorrow",
 * else "Sat 8 Nov". For pages read at the moment they render; text that is
 * shared and read later (share message, story image) keeps absolute dates.
 */
export function formatRelativeIstDay(d: Date, now: Date = new Date()): string {
  const c = istClock(d);
  if (c.ymd === istClock(now).ymd) return "Today";
  if (c.ymd === istClock(new Date(now.getTime() + 24 * 60 * 60 * 1000)).ymd) return "Tomorrow";
  return `${WEEKDAYS[c.weekday]} ${c.day} ${MONTHS[c.month]}`;
}

/** "5–9 pm", "5:30–9 pm", "11 am – 2 pm" (IST). */
export function formatIstTimeRange(start: Date, end: Date): string {
  const a = istClock(start);
  const b = istClock(end);
  const sameHalf = a.h < 12 === b.h < 12 && a.ymd === b.ymd;
  return sameHalf
    ? `${clockTime(a.h, a.m, false)}–${clockTime(b.h, b.m, true)}`
    : `${clockTime(a.h, a.m, true)} – ${clockTime(b.h, b.m, true)}`;
}

/** Every handover window a buyer sees: "Today · 5–9 pm", "Tomorrow · …", "Sat 8 Nov · …". */
export function formatWindowWithDay(start: Date, end: Date, now: Date = new Date()): string {
  return `${formatRelativeIstDay(start, now)} · ${formatIstTimeRange(start, end)}`;
}
