/**
 * Internal-only admin metrics for /admin/metrics. Definitions are in
 * docs/admin-redesign/PHASE-1.md.
 *
 * Windows are complete IST days (`istDayStart` below): "this week" is the 7 IST
 * days before today, "last week" the 7 before that, and today so far is reported
 * on its own, so both sides of a comparison are exactly 7 days long. Money is
 * paise-integer end-to-end; render via `formatINR` from `@/lib/currency`.
 */
import type { Prisma } from "@prisma/client";

import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";
import { type DayCounts, type TripwireResult, evaluateTripwires } from "@/lib/admin-tripwires";
import { utcToIstParts } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";

const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;

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

/** This window and the one before it. */
export type WindowPair = { current: number; prior: number };

export type AdminMetrics = {
  /** Distinct sellers with ≥ 1 paid bill. */
  activeSellers: WindowPair;
  /** Median over active sellers of (paid bills ÷ 7), one decimal. */
  billsPerSellerPerDayMedian: number;
  /** Paid bills rung up by voice ÷ all paid bills; 0 with no paid bills. */
  voiceShare: { share: number; voiceBills: number; paidBills: number; counterPaidBills: number };
  /** Sum of `totalPaise` over paid bills. */
  gmvPaise: WindowPair;
  /** Since 00:00 IST today, outside the comparison windows. */
  today: { paidBills: number; gmvPaise: number };
  /**
   * Storefront orders (any payment status) by `createdAt`, counted only from
   * `since` = max(window start, the day `orderChannel` was first written).
   */
  instagram: {
    since: Date;
    orders: number;
    paid: number;
    storefrontOrdersSince: number;
    /** Every storefront order in the window, tracked or not. */
    storefrontOrders: number;
  };
  /** One entry per IST day of this week, oldest first. */
  days: DayCounts[];
  tripwires: TripwireResult[];
  windows: {
    now: Date;
    todayStart: Date;
    thisWeekStart: Date;
    lastWeekStart: Date;
  };
};

/** Demo stores and their sample orders are not traction (lib/demo-store.ts). */
export const REAL_SALES = { isSample: false, vendor: { isDemo: false } } satisfies Prisma.TransactionWhereInput;

/**
 * Storefront orders placed in `[gte, lt)`, real stores only. The one definition
 * behind the Instagram card and the order leak map (lib/order-funnel-server.ts),
 * so the two always count the same orders.
 */
export function storefrontOrdersWhere(range: { gte: Date; lt: Date }) {
  return { ...REAL_SALES, source: "STOREFRONT", createdAt: range } satisfies Prisma.TransactionWhereInput;
}

function emptyDays(thisWeekStart: Date): DayCounts[] {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const start = new Date(thisWeekStart.getTime() + i * MS_PER_DAY);
    return {
      day: utcToIstParts(start).ymd,
      start,
      counts: { instagramOrders: 0, storefrontOrders: 0, voiceBills: 0, counterPaidBills: 0 },
    };
  });
}

/** Index into `emptyDays` (IST has no DST, so every day is 24 h). */
function dayIndex(at: Date, thisWeekStart: Date): number {
  return Math.floor((at.getTime() - thisWeekStart.getTime()) / MS_PER_DAY);
}

export async function getAdminMetrics(now: Date = new Date()): Promise<AdminMetrics> {
  const todayStart = istDayStart(0, now);
  const thisWeekStart = istDayStart(WINDOW_DAYS, now);
  const lastWeekStart = istDayStart(WINDOW_DAYS * 2, now);
  const thisWeek = { gte: thisWeekStart, lt: todayStart };
  const lastWeek = { gte: lastWeekStart, lt: thisWeekStart };
  const channelSince = ADMIN_METRICS_CONFIG.tracking.orderChannelSince;
  const instagramSince = channelSince > thisWeekStart ? channelSince : thisWeekStart;

  const paid = { ...REAL_SALES, paymentStatus: "PAID" } satisfies Prisma.TransactionWhereInput;

  const [thisWeekSellers, lastWeekSellers, thisWeekSum, lastWeekSum, todaySum, paidRows, storefrontRows] =
    await Promise.all([
      prisma.transaction.groupBy({ by: ["vendorId"], where: { ...paid, paidAt: thisWeek }, _count: { _all: true } }),
      prisma.transaction.groupBy({ by: ["vendorId"], where: { ...paid, paidAt: lastWeek }, _count: { _all: true } }),
      prisma.transaction.aggregate({ where: { ...paid, paidAt: thisWeek }, _sum: { totalPaise: true } }),
      prisma.transaction.aggregate({ where: { ...paid, paidAt: lastWeek }, _sum: { totalPaise: true } }),
      prisma.transaction.aggregate({
        where: { ...paid, paidAt: { gte: todayStart } },
        _sum: { totalPaise: true },
        _count: { _all: true },
      }),
      prisma.transaction.findMany({ where: { ...paid, paidAt: thisWeek }, select: { paidAt: true, source: true } }),
      prisma.transaction.findMany({
        where: storefrontOrdersWhere(thisWeek),
        select: { createdAt: true, orderChannel: true, paymentStatus: true },
      }),
    ]);

  const days = emptyDays(thisWeekStart);

  let voiceBills = 0;
  let counterPaidBills = 0;
  for (const row of paidRows) {
    const isVoice = row.source === "VOICE";
    const isCounter = row.source !== "STOREFRONT";
    if (isVoice) voiceBills += 1;
    if (isCounter) counterPaidBills += 1;
    const day = row.paidAt ? days[dayIndex(row.paidAt, thisWeekStart)] : undefined;
    if (!day) continue;
    if (isVoice) day.counts.voiceBills += 1;
    if (isCounter) day.counts.counterPaidBills += 1;
  }

  const instagram = { since: instagramSince, orders: 0, paid: 0, storefrontOrdersSince: 0, storefrontOrders: 0 };
  for (const row of storefrontRows) {
    instagram.storefrontOrders += 1;
    const fromInstagram = row.orderChannel === "instagram";
    if (row.createdAt >= instagramSince) {
      instagram.storefrontOrdersSince += 1;
      if (fromInstagram) {
        instagram.orders += 1;
        if (row.paymentStatus === "PAID") instagram.paid += 1;
      }
    }
    const day = days[dayIndex(row.createdAt, thisWeekStart)];
    if (!day) continue;
    day.counts.storefrontOrders += 1;
    if (fromInstagram) day.counts.instagramOrders += 1;
  }

  const paidBills = paidRows.length;
  const ratesPerSeller = thisWeekSellers.map((g) => g._count._all / WINDOW_DAYS);

  return {
    activeSellers: { current: thisWeekSellers.length, prior: lastWeekSellers.length },
    billsPerSellerPerDayMedian: Math.round(median(ratesPerSeller) * 10) / 10,
    voiceShare: { share: paidBills === 0 ? 0 : voiceBills / paidBills, voiceBills, paidBills, counterPaidBills },
    gmvPaise: { current: thisWeekSum._sum.totalPaise ?? 0, prior: lastWeekSum._sum.totalPaise ?? 0 },
    today: { paidBills: todaySum._count._all, gmvPaise: todaySum._sum.totalPaise ?? 0 },
    instagram,
    days,
    tripwires: evaluateTripwires(days),
    windows: { now, todayStart, thisWeekStart, lastWeekStart },
  };
}
