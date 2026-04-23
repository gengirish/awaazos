import { NextRequest, NextResponse } from "next/server";

import { getIstTodayStart } from "@/lib/billing-period";
import { withStatementTimeout } from "@/lib/db-timeout";
import { logger } from "@/lib/logger";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal metrics endpoint. Restricted to platform ADMIN+ users.
 *
 * Surfaces business KPIs we'd otherwise have to dig out of the dashboard
 * one query at a time:
 *  - Active vendors (signed up in last 7 / 30 days)
 *  - Today's POS transactions across all vendors
 *  - Voice-parse success rate (last 24h) — proxy for AI quality
 *  - Voice-parse latency p50 / p95 (last 24h)
 *  - Receipts queued / sent / failed (last 24h)
 *
 * Wire this into:
 *  - A status-page widget (Better Stack / Statuspage)
 *  - Your founder dashboard at /admin (TODO H6)
 *  - PagerDuty alerting (e.g., voice success rate < 80% → page)
 *
 * Output is intentionally JSON; downstream tools can scrape it.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePlatformRole("ADMIN");

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const todayIst = getIstTodayStart();

    const [
      vendorTotal,
      vendorsLast7d,
      vendorsLast30d,
      txnsToday,
      txnsLast24h,
      txnRevenue24hPaise,
      voiceParseLogs24h,
      receipts24h,
      receiptsSent24h,
    ] = await withStatementTimeout(8_000, async (tx) =>
      Promise.all([
        tx.vendor.count(),
        tx.vendor.count({ where: { createdAt: { gte: since7d } } }),
        tx.vendor.count({ where: { createdAt: { gte: since30d } } }),
        tx.transaction.count({ where: { createdAt: { gte: todayIst } } }),
        tx.transaction.count({ where: { createdAt: { gte: since24h } } }),
        tx.transaction.aggregate({
          where: { createdAt: { gte: since24h } },
          _sum: { totalPaise: true },
        }),
        tx.voiceParseLog.findMany({
          where: { createdAt: { gte: since24h } },
          select: { itemCount: true, latencyMs: true, escalated: true, confidence: true },
        }),
        tx.receipt.count({ where: { createdAt: { gte: since24h } } }),
        tx.receipt.count({ where: { createdAt: { gte: since24h }, whatsappSent: true } }),
      ]),
    );

    const voiceTotal = voiceParseLogs24h.length;
    const voiceSuccess = voiceParseLogs24h.filter((v) => v.itemCount > 0).length;
    const voiceEscalated = voiceParseLogs24h.filter((v) => v.escalated).length;
    const voiceLowConf = voiceParseLogs24h.filter((v) => v.confidence === "low").length;
    const successRate = voiceTotal > 0 ? voiceSuccess / voiceTotal : null;

    const sortedLatencies = voiceParseLogs24h
      .map((v) => v.latencyMs)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    const pct = (p: number): number | null => {
      if (sortedLatencies.length === 0) return null;
      const idx = Math.min(sortedLatencies.length - 1, Math.floor(p * sortedLatencies.length));
      return sortedLatencies[idx] ?? null;
    };

    const deliveryRate = receipts24h > 0 ? receiptsSent24h / receipts24h : null;

    return NextResponse.json({
      ts: now.toISOString(),
      growth: {
        vendorTotal,
        vendorsLast7d,
        vendorsLast30d,
      },
      transactions: {
        today: txnsToday,
        last24h: txnsLast24h,
        revenuePaiseLast24h: txnRevenue24hPaise._sum.totalPaise ?? 0,
      },
      voice: {
        last24h: voiceTotal,
        successRate,
        escalationRate: voiceTotal > 0 ? voiceEscalated / voiceTotal : null,
        lowConfidenceRate: voiceTotal > 0 ? voiceLowConf / voiceTotal : null,
        latencyMs: {
          p50: pct(0.5),
          p95: pct(0.95),
          p99: pct(0.99),
        },
      },
      receipts: {
        last24h: receipts24h,
        sent: receiptsSent24h,
        deliveryRate,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error(
      { route: "/api/_metrics", error: err instanceof Error ? err.message : "unknown" },
      "metrics endpoint failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
