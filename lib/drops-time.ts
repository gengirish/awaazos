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
export function formatIstDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

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
