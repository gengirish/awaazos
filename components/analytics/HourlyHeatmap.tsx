"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { BRAND } from "@/lib/constants";
import { formatINR, paiseToRupees } from "@/lib/currency";

export type HourlyRow = {
  hour: number;
  revenuePaise: number;
  txns: number;
};

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`;
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
    label: String(r.hour).padStart(2, "0"),
    revenueRupees: paiseToRupees(r.revenuePaise),
    fillOpacity: 0.35 + (0.65 * r.revenuePaise) / maxRev,
  }));

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="hourly-heading">
      <h2 id="hourly-heading" className="font-display text-lg font-semibold text-foreground">
        Sales by hour (IST)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Hours 00–23, totals across the selected range.</p>
      <div className="mt-4 h-72 w-full" role="img" aria-label="Bar chart of revenue by hour of day">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatINR(Math.round(v * 100))} />
            <Tooltip
              formatter={(value: number, _name, item) => {
                const payload = item?.payload as HourlyRow & { label: string };
                const orders = payload?.txns ?? 0;
                return [`${formatINR(Math.round(value * 100))} / ${orders} orders`, "Revenue"];
              }}
              labelFormatter={(_label, payload) => {
                const h = (payload?.[0]?.payload as HourlyRow | undefined)?.hour ?? 0;
                return hourLabel(h);
              }}
            />
            <Bar dataKey="revenueRupees" radius={[4, 4, 0, 0]} name="Revenue">
              {chartData.map((entry) => (
                <Cell key={entry.hour} fill={BRAND.primary} fillOpacity={entry.fillOpacity} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Show data table</summary>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Revenue and order count per hour</caption>
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
                <td className="py-2 pr-4 tabular-nums">{String(row.hour).padStart(2, "0")}</td>
                <td className="py-2 pr-4 tabular-nums">{formatINR(row.revenuePaise)}</td>
                <td className="py-2 tabular-nums">{row.txns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
