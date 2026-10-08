"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatINR, paiseToRupees } from "@/lib/currency";

export type RevenueTrendPoint = {
  dateKey: string;
  dateLabel: string;
  revenuePaise: number;
};

export type RevenueTrendChartProps = {
  data: RevenueTrendPoint[];
  title?: string;
};

export function RevenueTrendChart({ data, title = "Revenue trend" }: RevenueTrendChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    revenueRupees: paiseToRupees(d.revenuePaise),
  }));

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs" aria-labelledby="revenue-trend-heading">
      <h2 id="revenue-trend-heading" className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-4 h-72 w-full" role="img" aria-label={`${title}: line chart of daily revenue`}>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No revenue in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => formatINR(Math.round(v * 100))}
              />
              <Tooltip
                formatter={(value: number) => [formatINR(Math.round(value * 100)), "Revenue"]}
                labelFormatter={(label) => `Date ${label}`}
              />
              <Line type="monotone" dataKey="revenueRupees" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Revenue" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <details className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Show data table</summary>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Daily revenue figures for the selected range</caption>
          <thead>
            <tr>
              <th className="pb-2 pr-4 font-medium">Date</th>
              <th className="pb-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.dateKey} className="border-t border-border">
                <td className="py-2 pr-4">{row.dateLabel}</td>
                <td className="py-2 tabular-nums">{formatINR(row.revenuePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
