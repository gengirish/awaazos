/**
 * Internal-only admin metrics for the YC partner dashboard at /admin/metrics.
 *
 * All time math is anchored to IST (Asia/Kolkata) midnights — see
 * `istDayStart` below. Money is paise-integer end-to-end; render via
 * `formatINR` from `@/lib/currency` at the UI boundary.
 */
import { prisma } from "@/lib/prisma";

const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns the UTC `Date` corresponding to the start of the IST calendar day
 * that is `daysAgo` days before today (in IST).
 *
 * `istDayStart(0)` → today's 00:00:00 IST as a UTC instant.
 * `istDayStart(7)` → 7 days ago at 00:00:00 IST as a UTC instant.
 *
 * Exposed so date-window logic can be unit-tested without a live DB.
 */
export function istDayStart(daysAgo: number, now: Date = new Date()): Date {
  const utcMs = now.getTime();
  const istMs = utcMs + IST_OFFSET_MS;
  const istToday = new Date(istMs);
  istToday.setUTCHours(0, 0, 0, 0);
  const istMidnightUtc = istToday.getTime() - IST_OFFSET_MS;
  return new Date(istMidnightUtc - daysAgo * MS_PER_DAY);
}

/** Statistical median. Empty input → 0. Even-length → average of two middles. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Week-over-week relative change: (this - last) / max(last, 1).
 * `max(last, 1)` is the agreed divide-by-zero guard so a fresh-week
 * baseline of 0 doesn't blow up to Infinity.
 */
export function wowDelta(thisWeek: number, lastWeek: number): number {
  return (thisWeek - lastWeek) / Math.max(lastWeek, 1);
}

export type AdminMetrics = {
  weeklyActiveVendors: number;
  billsPerVendorPerDayMedian: number;
  voiceSuccessRate7d: number;
  weeklyGmvPaise: number;
  wowGrowth: {
    activeVendorsWoW: number;
    gmvWoW: number;
  };
  windows: {
    now: Date;
    thisWeekStart: Date;
    lastWeekStart: Date;
  };
};

export async function getAdminMetrics(now: Date = new Date()): Promise<AdminMetrics> {
  const thisWeekStart = istDayStart(7, now);
  const lastWeekStart = istDayStart(14, now);

  const [
    thisWeekVendorGroups,
    thisWeekVoiceCount,
    thisWeekPaidCount,
    thisWeekSum,
    lastWeekVendorGroups,
    lastWeekSum,
  ] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: { paymentStatus: "PAID", paidAt: { gte: thisWeekStart } },
      _count: { _all: true },
    }),
    prisma.transaction.count({
      where: {
        paymentStatus: "PAID",
        paidAt: { gte: thisWeekStart },
        source: "VOICE",
      },
    }),
    prisma.transaction.count({
      where: { paymentStatus: "PAID", paidAt: { gte: thisWeekStart } },
    }),
    prisma.transaction.aggregate({
      where: { paymentStatus: "PAID", paidAt: { gte: thisWeekStart } },
      _sum: { totalPaise: true },
    }),
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: {
        paymentStatus: "PAID",
        paidAt: { gte: lastWeekStart, lt: thisWeekStart },
      },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: {
        paymentStatus: "PAID",
        paidAt: { gte: lastWeekStart, lt: thisWeekStart },
      },
      _sum: { totalPaise: true },
    }),
  ]);

  const weeklyActiveVendors = thisWeekVendorGroups.length;

  const ratesPerVendor = thisWeekVendorGroups.map((g) => g._count._all / 7);
  const billsPerVendorPerDayMedian = Math.round(median(ratesPerVendor) * 10) / 10;

  const voiceSuccessRate7d =
    thisWeekPaidCount === 0 ? 0 : thisWeekVoiceCount / thisWeekPaidCount;

  const weeklyGmvPaise = thisWeekSum._sum.totalPaise ?? 0;

  const lastWeekActiveVendors = lastWeekVendorGroups.length;
  const lastWeekGmvPaise = lastWeekSum._sum.totalPaise ?? 0;

  return {
    weeklyActiveVendors,
    billsPerVendorPerDayMedian,
    voiceSuccessRate7d,
    weeklyGmvPaise,
    wowGrowth: {
      activeVendorsWoW: wowDelta(weeklyActiveVendors, lastWeekActiveVendors),
      gmvWoW: wowDelta(weeklyGmvPaise, lastWeekGmvPaise),
    },
    windows: {
      now,
      thisWeekStart,
      lastWeekStart,
    },
  };
}
