"use client";

import { formatINR } from "@/lib/currency";

import { ChartDataTable } from "./ChartDataTable";
import { HourlyPlot } from "./lazy-plots";

export type HourlyRow = {
  hour: number;
  revenuePaise: number;
  txns: number;
};

function twoDigits(h: number): string {
  return String(h).padStart(2, "0");
}

export type HourlyHeatmapProps = {
  rows: HourlyRow[];
};

export function HourlyHeatmap({ rows }: HourlyHeatmapProps) {
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const full24: HourlyRow[] = [];
  for (let h = 0; h < 24; h++) {
    full24.push(byHour.get(h) ?? { hour: h, revenuePaise: 0, txns: 0 });
  }

  const maxRev = Math.max(1, ...full24.map((r) => r.revenuePaise));

  const chartData = full24.map((r) => ({
    ...r,
    label: twoDigits(r.hour),
    rangeLabel: `${twoDigits(r.hour)}:00–${twoDigits(r.hour)}:59`,
    fillOpacity: 0.35 + (0.65 * r.revenuePaise) / maxRev,
  }));

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs" aria-labelledby="hourly-heading">
      <h2 id="hourly-heading" className="font-display text-lg font-semibold text-foreground">
        Sales by hour (IST)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Hours 00–23, totals across the selected range.</p>
      <div className="mt-4 h-60 w-full sm:h-72" role="img" aria-label="Bar chart of revenue by hour of day">
        <HourlyPlot data={chartData} />
      </div>
      <ChartDataTable caption="Revenue and order count per hour">
        <thead>
          <tr>
            <th className="pb-2 pr-4 font-medium">Hour (IST)</th>
            <th className="pb-2 pr-4 font-medium">Revenue</th>
            <th className="pb-2 font-medium">Orders</th>
          </tr>
        </thead>
        <tbody>
          {full24.map((row) => (
            <tr key={row.hour} className="border-t border-border">
              <td className="py-2 pr-4 tabular-nums">{twoDigits(row.hour)}</td>
              <td className="py-2 pr-4 tabular-nums">{formatINR(row.revenuePaise)}</td>
              <td className="py-2 tabular-nums">{row.txns}</td>
            </tr>
          ))}
        </tbody>
      </ChartDataTable>
    </section>
  );
}
