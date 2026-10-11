"use client";

/**
 * Lazy entry points for the recharts plots in `plots.tsx`.
 *
 * recharts is the heaviest thing on /analytics and the charts cannot draw on
 * the server anyway (`ResponsiveContainer` needs a measured box), so they load
 * client-side after the header, range switcher, KPI tiles and data tables.
 * All four share one chunk.
 *
 * Render a plot inside a box with a fixed height: the skeleton and the chart
 * both fill it, so nothing moves when the chunk arrives.
 */
import dynamic from "next/dynamic";

function PlotSkeleton() {
  return <div aria-hidden="true" className="h-full w-full rounded-md bg-muted motion-safe:animate-pulse" />;
}

function RoundPlotSkeleton() {
  return <div aria-hidden="true" className="h-full w-full rounded-full bg-muted motion-safe:animate-pulse" />;
}

export const RevenueTrendPlot = dynamic(() => import("./plots").then((m) => m.RevenueTrendPlot), {
  ssr: false,
  loading: PlotSkeleton,
});

export const HourlyPlot = dynamic(() => import("./plots").then((m) => m.HourlyPlot), {
  ssr: false,
  loading: PlotSkeleton,
});

export const PaymentPiePlot = dynamic(() => import("./plots").then((m) => m.PaymentPiePlot), {
  ssr: false,
  loading: PlotSkeleton,
});

export const VoiceDonutPlot = dynamic(() => import("./plots").then((m) => m.VoiceDonutPlot), {
  ssr: false,
  loading: RoundPlotSkeleton,
});
