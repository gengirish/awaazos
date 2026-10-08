"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { BRAND } from "@/lib/constants";

export type VoiceAdoptionCardProps = {
  voiceCount: number;
  totalCount: number;
  percent: number;
};

export function VoiceAdoptionCard({ voiceCount, totalCount, percent }: VoiceAdoptionCardProps) {
  const other = Math.max(0, totalCount - voiceCount);
  const data = [
    { name: "Voice orders", value: voiceCount, fill: BRAND.primary },
    { name: "Other orders", value: other, fill: "hsl(var(--muted))" },
  ];

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-xs"
      aria-labelledby="voice-adoption-heading"
    >
      <h2 id="voice-adoption-heading" className="font-display text-lg font-semibold text-foreground">
        Voice adoption
      </h2>
      {totalCount === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No orders in this range.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-40 w-40 shrink-0" role="img" aria-label={`Donut chart: ${percent}% voice orders`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={64}>
                    {data.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-foreground">
              <span className="font-semibold tabular-nums">{percent}%</span> of orders from voice
              <span className="text-muted-foreground">
                {" "}
                ({voiceCount} voice / {totalCount} total)
              </span>
            </p>
          </div>
          <details className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">Show data table</summary>
            <table className="mt-3 w-full text-left text-sm">
              <caption className="sr-only">Order counts by source for voice adoption</caption>
              <thead>
                <tr>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Orders</th>
                  <th className="pb-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="py-2 pr-4">Voice</td>
                  <td className="py-2 pr-4 tabular-nums">{voiceCount}</td>
                  <td className="py-2 tabular-nums">{totalCount > 0 ? `${percent}%` : "—"}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-2 pr-4">Other</td>
                  <td className="py-2 pr-4 tabular-nums">{other}</td>
                  <td className="py-2 tabular-nums">
                    {totalCount > 0 ? `${Math.round((other / totalCount) * 100)}%` : "—"}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">Total</td>
                  <td className="py-2 pr-4 tabular-nums">{totalCount}</td>
                  <td className="py-2 tabular-nums">100%</td>
                </tr>
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
