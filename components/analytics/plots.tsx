"use client";

/**
 * Every recharts import in the app lives in this file, so the library ships as
 * one lazy chunk. Never import it directly: `lazy-plots.tsx` loads it with
 * `next/dynamic` after the page shell, KPI tiles and data tables have rendered.
 *
 * Each plot fills its parent, which must have a fixed height (the card owns the
 * box, so the skeleton and the chart are the same size — no layout shift).
 *
 * Values are plotted in integer paise, the unit the rest of the app uses, so
 * tooltips format the stored amount as-is. Only axis ticks are shortened.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { BRAND } from "@/lib/constants";
import { formatINR } from "@/lib/currency";

import { formatAxisINR } from "./axis-format";

/** Fits "₹99.9Cr" at 11 px; recharts' default 60 px wastes a fifth of a phone-width chart. */
const Y_AXIS_WIDTH = 48;
const AXIS_TICK = { fontSize: 11 };
const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 4 };

export type RevenueTrendPlotPoint = { dateLabel: string; revenuePaise: number };

export function RevenueTrendPlot({ data }: { data: RevenueTrendPlotPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        {/* Default interval ("preserveEnd") drops labels that would collide; the gap keeps 90 days readable. */}
        <XAxis dataKey="dateLabel" tick={AXIS_TICK} minTickGap={12} tickMargin={6} />
        <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} tickFormatter={formatAxisINR} />
        <Tooltip
          formatter={(value: number) => [formatINR(value), "Revenue"]}
          labelFormatter={(label) => `Date ${label}`}
        />
        <Line
          type="monotone"
          dataKey="revenuePaise"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          // A single day has no line to draw; without a dot the chart would be empty.
          dot={data.length === 1}
          name="Revenue"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export type HourlyPlotPoint = {
  hour: number;
  label: string;
  rangeLabel: string;
  revenuePaise: number;
  txns: number;
  fillOpacity: number;
};

export function HourlyPlot({ data }: { data: HourlyPlotPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        {/* Every third hour: 8 labels, which fit a 280 px plot. */}
        <XAxis dataKey="label" tick={AXIS_TICK} interval={2} tickMargin={6} />
        <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} tickFormatter={formatAxisINR} />
        <Tooltip
          formatter={(value: number, _name, item) => {
            const orders = (item?.payload as HourlyPlotPoint | undefined)?.txns ?? 0;
            return [`${formatINR(value)} / ${orders} orders`, "Revenue"];
          }}
          labelFormatter={(label, payload) =>
            (payload?.[0]?.payload as HourlyPlotPoint | undefined)?.rangeLabel ?? String(label)
          }
        />
        <Bar dataKey="revenuePaise" radius={[4, 4, 0, 0]} name="Revenue">
          {data.map((entry) => (
            <Cell key={entry.hour} fill={BRAND.primary} fillOpacity={entry.fillOpacity} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type PaymentPiePlotSlice = { key: string; label: string; paise: number; color: string };

export function PaymentPiePlot({ data }: { data: PaymentPiePlotSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="paise" nameKey="label" cx="50%" cy="50%" innerRadius={48} outerRadius={88} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => formatINR(value)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VoiceDonutPlot({ voiceCount, otherCount }: { voiceCount: number; otherCount: number }) {
  const data = [
    { name: "Voice orders", value: voiceCount, fill: BRAND.primary },
    { name: "Other orders", value: otherCount, fill: "hsl(var(--muted))" },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="60%" outerRadius="88%">
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
