import type { DailySummary } from "@prisma/client";

import { getIstTodayStart } from "@/lib/billing-period";

export type DailySummaryKpiRow = Pick<
  DailySummary,
  "totalRevenuePaise" | "totalTransactions" | "totalItemsSold" | "cashRevenuePaise" | "upiRevenuePaise"
>;

export function sumDailySummariesKpis(rows: DailySummaryKpiRow[]): {
  totalRevenuePaise: number;
  totalTransactions: number;
  totalItemsSold: number;
  cashRevPaise: number;
  upiRevPaise: number;
} {
  let totalRevenuePaise = 0;
  let totalTransactions = 0;
  let totalItemsSold = 0;
  let cashRevPaise = 0;
  let upiRevPaise = 0;

  for (const r of rows) {
    totalRevenuePaise += r.totalRevenuePaise;
    totalTransactions += r.totalTransactions;
    totalItemsSold += r.totalItemsSold;
    cashRevPaise += r.cashRevenuePaise;
    upiRevPaise += r.upiRevenuePaise;
  }

  return {
    totalRevenuePaise,
    totalTransactions,
    totalItemsSold,
    cashRevPaise,
    upiRevPaise,
  };
}

/** Integer percentage 0–100; guards divide-by-zero. */
export function voiceAdoptionPercent(voiceCount: number, totalCount: number): number {
  if (totalCount <= 0 || voiceCount <= 0) return 0;
  return Math.round((voiceCount / totalCount) * 100);
}

export function clampRangeToPlanHistory(
  requestedDays: number,
  planHistoryDays: number | null,
): { days: number; wasClamped: boolean } {
  if (planHistoryDays === null) {
    return { days: requestedDays, wasClamped: false };
  }
  const days = Math.min(requestedDays, planHistoryDays);
  return { days, wasClamped: requestedDays > planHistoryDays };
}

/**
 * IST calendar arithmetic: `istDayStart` must be a vendor summary day (`getIstTodayStart` form).
 */
export function addIstCalendarDays(istDayStart: Date, deltaDays: number): Date {
  const IST = "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(istDayStart);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  return getIstTodayStart(new Date(utc));
}

/** Inclusive day count between two IST summary day starts (same storage convention). */
export function inclusiveIstDayCount(istStart: Date, istEnd: Date): number {
  const start = getIstTodayStart(istStart);
  const end = getIstTodayStart(istEnd);
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/** End of IST storage calendar day (23:59:59.999Z for that summary key). */
export function endOfIstStorageDay(istDayStart: Date): Date {
  const ymd = istDayStart.toISOString().slice(0, 10);
  const [y, m, d] = ymd.split("-");
  return new Date(`${y}-${m}-${d}T23:59:59.999Z`);
}
