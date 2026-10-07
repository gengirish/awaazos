/**
 * IST calendar boundaries for billing, DailySummary, and BillSequence @db.Date.
 * Date-only values use `YYYY-MM-DDT00:00:00.000Z` to match existing POS/DailySummary usage.
 */

const IST = "Asia/Kolkata";

function istYmdParts(d: Date): { y: string; m: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return { y, m, day };
}

/**
 * Calendar “today” in IST as a Date stored like POS `startOfTodayIST` — midnight UTC
 * of the IST calendar Y-M-D for Postgres `@db.Date` keys.
 */
export function getIstTodayStart(now: Date = new Date()): Date {
  const { y, m, day } = istYmdParts(now);
  return new Date(`${y}-${m}-${day}T00:00:00.000Z`);
}

/** `YYYYMMDD` for bill numbers, interpreted in IST for `date`. */
export function formatBillDateYYYYMMDD(date: Date): string {
  const { y, m, day } = istYmdParts(date);
  return `${y}${m}${day}`;
}

/** First calendar day of the current IST month, 00:00 (same storage convention as today). */
export function getIstMonthStart(now: Date = new Date()): Date {
  const { y, m } = istYmdParts(now);
  return new Date(`${y}-${m}-01T00:00:00.000Z`);
}

/** Inclusive IST day range from `YYYY-MM-DD` query params. */
export function istDayRangeFromQuery(fromStr: string | null, toStr: string | null): { from?: Date; to?: Date } {
  if (!fromStr && !toStr) return {};
  const endOfIstDay = (y: string, m: string, day: string) => new Date(`${y}-${m}-${day}T23:59:59.999Z`);
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
    const [y, m, d] = fromStr.split("-");
    from = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  }
  if (toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    const [y, m, d] = toStr.split("-");
    to = endOfIstDay(y!, m!, d!);
  }
  return { from, to };
}
