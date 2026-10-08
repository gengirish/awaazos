import { redirect } from "next/navigation";

import { type Plan, Prisma } from "@prisma/client";

import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import type { HourlyRow } from "@/components/analytics/HourlyHeatmap";
import type { PaymentSlice } from "@/components/analytics/PaymentMethodBreakdown";
import type { RevenueTrendPoint } from "@/components/analytics/RevenueTrendChart";
import type { TopItemRow } from "@/components/analytics/TopItemsList";
import type { AnalyticsRange } from "@/components/analytics/types";
import {
  addIstCalendarDays,
  clampRangeToPlanHistory,
  endOfIstStorageDay,
  inclusiveIstDayCount,
  sumDailySummariesKpis,
  voiceAdoptionPercent,
} from "@/lib/analytics-aggregations";
import { getIstTodayStart, istDayRangeFromQuery } from "@/lib/billing-period";
import { PLAN_LIMITS } from "@/lib/constants";
import { billableTxnSql, billableTxnWhere } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseRange(r: string | undefined): AnalyticsRange {
  const allowed: AnalyticsRange[] = ["today", "7d", "30d", "90d", "custom"];
  if (r && (allowed as string[]).includes(r)) return r as AnalyticsRange;
  return "7d";
}

function toInputDate(istDayStart: Date): string {
  return istDayStart.toISOString().slice(0, 10);
}

function planAnalyticsCap(plan: Plan): number | null {
  if (plan === "ENTERPRISE") return null;
  return PLAN_LIMITS[plan].analyticsDays;
}

export default async function AnalyticsPage(props: Props) {
  const searchParams = await props.searchParams;
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("MANAGER");
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const vendorId = ctx.vendor.id;
  const now = new Date();
  const todayStart = getIstTodayStart(now);

  const planCap = planAnalyticsCap(ctx.vendor.plan);
  const range = parseRange(firstParam(searchParams.range));
  const fromQ = firstParam(searchParams.from);
  const toQ = firstParam(searchParams.to);

  let firstDay: Date;
  let lastDay: Date;

  switch (range) {
    case "today":
      firstDay = todayStart;
      lastDay = todayStart;
      break;
    case "7d":
      lastDay = todayStart;
      firstDay = addIstCalendarDays(todayStart, -6);
      break;
    case "30d":
      lastDay = todayStart;
      firstDay = addIstCalendarDays(todayStart, -29);
      break;
    case "90d":
      lastDay = todayStart;
      firstDay = addIstCalendarDays(todayStart, -89);
      break;
    case "custom": {
      const { from, to } = istDayRangeFromQuery(fromQ ?? null, toQ ?? null);
      if (from && to) {
        firstDay = getIstTodayStart(from);
        lastDay = getIstTodayStart(to);
        if (firstDay.getTime() > lastDay.getTime()) {
          const t = firstDay;
          firstDay = lastDay;
          lastDay = t;
        }
      } else {
        lastDay = todayStart;
        firstDay = addIstCalendarDays(todayStart, -6);
      }
      break;
    }
  }

  const requestedDays = inclusiveIstDayCount(firstDay, lastDay);
  const { days: effectiveDays, wasClamped } = clampRangeToPlanHistory(requestedDays, planCap);
  if (effectiveDays < requestedDays) {
    firstDay = addIstCalendarDays(lastDay, -(effectiveDays - 1));
  }

  const lastDayIsToday = lastDay.getTime() === todayStart.getTime();
  const txnRangeEnd = lastDayIsToday
    ? new Date(Math.min(now.getTime(), endOfIstStorageDay(lastDay).getTime()))
    : endOfIstStorageDay(lastDay);
  const txnRangeStart = firstDay;

  const suggestedCustomFrom = toInputDate(addIstCalendarDays(todayStart, -6));
  const suggestedCustomTo = toInputDate(todayStart);

  const customFromResolved =
    range === "custom" && fromQ && /^\d{4}-\d{2}-\d{2}$/.test(fromQ) ? fromQ : undefined;
  const customToResolved =
    range === "custom" && toQ && /^\d{4}-\d{2}-\d{2}$/.test(toQ) ? toQ : undefined;

  // Transaction-level tiles (transaction count, voice share, hourly heatmap,
  // top items, payment mix) all count the same rows: billable transactions
  // (`billableTxnWhere` — counter sales plus *paid* storefront orders) created
  // in range. Unpaid/expired/cancelled pre-orders never show up as sales.
  const billableInRange: Prisma.TransactionWhereInput = {
    vendorId,
    createdAt: { gte: txnRangeStart, lte: txnRangeEnd },
    ...billableTxnWhere(),
  };

  const [
    dailyRows,
    hourlyRaw,
    topRaw,
    voiceCount,
    totalTxnCount,
    paymentGroups,
  ] = await Promise.all([
    prisma.dailySummary.findMany({
      where: { vendorId, date: { gte: firstDay, lte: lastDay } },
      orderBy: { date: "asc" },
    }),
    prisma.$queryRaw<{ hour: number; revenue: bigint; txns: number }[]>(Prisma.sql`
      SELECT
        EXTRACT(HOUR FROM (t."createdAt" AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
        SUM(t."totalPaise")::bigint AS revenue,
        COUNT(*)::int AS txns
      FROM transactions t
      WHERE t."vendorId" = ${vendorId}
        AND t."createdAt" >= ${txnRangeStart}
        AND t."createdAt" <= ${txnRangeEnd}
        AND ${billableTxnSql}
      GROUP BY 1
      ORDER BY 1
    `),
    prisma.$queryRaw<
      { menuItemId: string | null; name: string; qty: number; totalPaise: bigint; emoji: string | null }[]
    >(Prisma.sql`
      SELECT oi."menuItemId", oi.name, SUM(oi.qty)::int AS qty, SUM(oi."totalPaise")::bigint AS "totalPaise",
        MAX(mi.emoji) AS emoji
      FROM order_items oi
      INNER JOIN transactions t ON t.id = oi."transactionId"
      LEFT JOIN menu_items mi ON mi.id = oi."menuItemId" AND mi."vendorId" = t."vendorId"
      WHERE t."vendorId" = ${vendorId}
        AND t."createdAt" >= ${txnRangeStart}
        AND t."createdAt" <= ${txnRangeEnd}
        AND ${billableTxnSql}
      GROUP BY oi."menuItemId", oi.name
      ORDER BY qty DESC
      LIMIT 10
    `),
    // VOICE is never STOREFRONT, so this is a strict subset of totalTxnCount.
    prisma.transaction.count({
      where: { ...billableInRange, source: "VOICE" },
    }),
    prisma.transaction.count({ where: billableInRange }),
    prisma.transaction.groupBy({
      by: ["paymentMethod"],
      where: billableInRange,
      _sum: { totalPaise: true },
    }),
  ]);

  // Revenue, items sold, trend and avg ticket come from DailySummary (storefront
  // orders dated by paidAt there). Avg ticket keeps numerator and denominator
  // from that same rollup so the ratio is never mixed-source; the "Total
  // transactions" tile uses totalTxnCount so it always matches the voice tile.
  const kpis = sumDailySummariesKpis(dailyRows);
  const hasSales = kpis.totalTransactions > 0 || totalTxnCount > 0;
  const avgTicketPaise =
    kpis.totalTransactions > 0 ? Math.round(kpis.totalRevenuePaise / kpis.totalTransactions) : 0;

  const hourly: HourlyRow[] = hourlyRaw.map((r) => ({
    hour: r.hour,
    revenuePaise: Number(r.revenue),
    txns: r.txns,
  }));

  const topItems: TopItemRow[] = topRaw.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    qty: r.qty,
    revenuePaise: Number(r.totalPaise),
    emoji: r.emoji,
  }));
  const maxQty = topItems.length ? Math.max(...topItems.map((t) => t.qty)) : 1;

  const revenueTrend: RevenueTrendPoint[] = dailyRows.map((row) => {
    const dateKey = row.date.toISOString().slice(0, 10);
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(row.date);
    return {
      dateKey,
      dateLabel,
      revenuePaise: row.totalRevenuePaise,
    };
  });

  let cashPaise = 0;
  let upiPaise = 0;
  let otherPaise = 0;
  for (const g of paymentGroups) {
    const v = g._sum.totalPaise ?? 0;
    if (g.paymentMethod === "CASH") cashPaise += v;
    else if (g.paymentMethod === "UPI") upiPaise += v;
    else otherPaise += v;
  }

  const paymentSlices: PaymentSlice[] = [
    { key: "cash", label: "Cash", paise: cashPaise },
    { key: "upi", label: "UPI", paise: upiPaise },
    { key: "other", label: "Other", paise: otherPaise },
  ];

  const voicePct = voiceAdoptionPercent(voiceCount, totalTxnCount);

  const revenueLabel =
    range === "today"
      ? "Today's revenue"
      : range === "7d"
        ? "Revenue (7 days)"
        : range === "30d"
          ? "Revenue (30 days)"
          : range === "90d"
            ? "Revenue (90 days)"
            : "Revenue (custom)";

  const trendTitle =
    range === "today" ? "Today's revenue (daily rollup)" : "Daily revenue (IST calendar days)";

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <header className="mx-auto mb-6 flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">Sales snapshot for {ctx.vendor.name}</p>
        </div>
        <a
          href="/pos"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to POS
        </a>
      </header>

      <main id="main" className="mx-auto max-w-6xl">
        <AnalyticsDashboard
          range={range}
          customFrom={customFromResolved}
          customTo={customToResolved}
          suggestedCustomFrom={suggestedCustomFrom}
          suggestedCustomTo={suggestedCustomTo}
          wasClamped={wasClamped}
          revenueLabel={revenueLabel}
          trendTitle={trendTitle}
          kpis={{
            totalRevenuePaise: kpis.totalRevenuePaise,
            totalTransactions: totalTxnCount,
            avgTicketPaise,
            totalItemsSold: kpis.totalItemsSold,
          }}
          revenueTrend={revenueTrend}
          hourly={hourly}
          topItems={topItems}
          maxQty={maxQty}
          voice={{ voiceCount, totalCount: totalTxnCount, percent: voicePct }}
          paymentSlices={paymentSlices}
          hasSales={hasSales}
        />
      </main>
    </div>
  );
}
