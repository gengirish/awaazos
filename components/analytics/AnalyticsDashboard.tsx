"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { HourlyHeatmap, type HourlyRow } from "./HourlyHeatmap";
import { KpiGrid } from "./KpiGrid";
import { PaymentMethodBreakdown, type PaymentSlice } from "./PaymentMethodBreakdown";
import { RangeSwitcher } from "./RangeSwitcher";
import { RevenueTrendChart, type RevenueTrendPoint } from "./RevenueTrendChart";
import { TopItemsList, type TopItemRow } from "./TopItemsList";
import type { AnalyticsRange } from "./types";
import { VoiceAdoptionCard } from "./VoiceAdoptionCard";

export type AnalyticsDashboardProps = {
  range: AnalyticsRange;
  customFrom?: string;
  customTo?: string;
  suggestedCustomFrom: string;
  suggestedCustomTo: string;
  wasClamped: boolean;
  revenueLabel: string;
  trendTitle: string;
  kpis: {
    totalRevenuePaise: number;
    totalTransactions: number;
    avgTicketPaise: number;
    totalItemsSold: number;
  };
  revenueTrend: RevenueTrendPoint[];
  hourly: HourlyRow[];
  topItems: TopItemRow[];
  maxQty: number;
  voice: { voiceCount: number; totalCount: number; percent: number };
  paymentSlices: PaymentSlice[];
  hasSales: boolean;
};

export function AnalyticsDashboard({
  range,
  customFrom,
  customTo,
  suggestedCustomFrom,
  suggestedCustomTo,
  wasClamped,
  revenueLabel,
  trendTitle,
  kpis,
  revenueTrend,
  hourly,
  topItems,
  maxQty,
  voice,
  paymentSlices,
  hasSales,
}: AnalyticsDashboardProps) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {wasClamped ? (
        <Card className="border-dashed border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            {/* <h2>, not CardTitle (an <h3>): these sit directly under the page <h1>. */}
            <h2 className="font-display text-lg font-semibold leading-none tracking-tight">Showing partial history</h2>
            <CardDescription>
              Your plan limits how far back analytics can go. Upgrade for full history and longer ranges.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild className="min-h-11">
              <Link href="/settings/billing">Upgrade for full history</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <RangeSwitcher
        active={range}
        customFrom={customFrom}
        customTo={customTo}
        suggestedCustomFrom={suggestedCustomFrom}
        suggestedCustomTo={suggestedCustomTo}
      />

      {!hasSales ? (
        <EmptyState
          title="No sales yet — head to the POS and bol bill becho!"
          titleAs="h2"
          description="Charts and KPIs will fill in once you record bills."
          action={
            <Button asChild className="min-h-11">
              <Link href="/pos">Open POS</Link>
            </Button>
          }
        />
      ) : null}

      <KpiGrid
        revenueLabel={revenueLabel}
        totalRevenuePaise={kpis.totalRevenuePaise}
        totalTransactions={kpis.totalTransactions}
        avgTicketPaise={kpis.avgTicketPaise}
        totalItemsSold={kpis.totalItemsSold}
        hasSales={hasSales}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RevenueTrendChart data={revenueTrend} title={trendTitle} />
        <HourlyHeatmap rows={hourly} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopItemsList items={topItems} maxQty={maxQty} />
        <div className="min-w-0 space-y-6">
          <VoiceAdoptionCard voiceCount={voice.voiceCount} totalCount={voice.totalCount} percent={voice.percent} />
          <PaymentMethodBreakdown slices={paymentSlices} />
        </div>
      </div>
    </div>
  );
}
