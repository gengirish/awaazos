"use client";

import { formatINR } from "@/lib/currency";

import { ChartDataTable } from "./ChartDataTable";
import { RevenueTrendPlot } from "./lazy-plots";

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
  return (
    <section
      className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs"
      aria-labelledby="revenue-trend-heading"
    >
      <h2 id="revenue-trend-heading" className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No revenue in this range.</p>
      ) : (
        <div className="mt-4 h-60 w-full sm:h-72" role="img" aria-label={`${title}: line chart of daily revenue`}>
          <RevenueTrendPlot data={data} />
        </div>
      )}
      <ChartDataTable caption="Daily revenue figures for the selected range">
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
      </ChartDataTable>
    </section>
  );
}
