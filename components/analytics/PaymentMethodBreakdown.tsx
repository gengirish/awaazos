"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { BRAND } from "@/lib/constants";
import { formatINR, paiseToRupees } from "@/lib/currency";

export type PaymentSlice = {
  key: string;
  label: string;
  paise: number;
};

const COLORS = [BRAND.primary, BRAND.green, BRAND.blue, BRAND.amber];

export type PaymentMethodBreakdownProps = {
  slices: PaymentSlice[];
};

export function PaymentMethodBreakdown({ slices }: PaymentMethodBreakdownProps) {
  const data = slices.filter((s) => s.paise > 0).map((s) => ({
    ...s,
    rupees: paiseToRupees(s.paise),
  }));

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      aria-labelledby="payment-mix-heading"
    >
      <h2 id="payment-mix-heading" className="font-display text-lg font-semibold text-foreground">
        Payment mix
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">By revenue in the selected range.</p>
      <div className="mt-4 h-64 w-full" role="img" aria-label="Pie chart of revenue by payment method">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paid volume in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="rupees"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={88}
                paddingAngle={2}
              >
                {data.map((entry, index) => (
                  <Cell key={entry.key} fill={COLORS[index % COLORS.length]!} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatINR(Math.round(value * 100))} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <details className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Show data table</summary>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Revenue by payment method</caption>
          <thead>
            <tr>
              <th className="pb-2 pr-4 font-medium">Method</th>
              <th className="pb-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <td className="py-2 pr-4">{row.label}</td>
                <td className="py-2 tabular-nums">{formatINR(row.paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
