"use client";

import { BRAND } from "@/lib/constants";
import { formatINR } from "@/lib/currency";

import { sharePercent } from "./axis-format";
import { ChartDataTable } from "./ChartDataTable";
import { PaymentPiePlot } from "./lazy-plots";

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
  const data = slices
    .filter((s) => s.paise > 0)
    .map((s, index) => ({ ...s, color: COLORS[index % COLORS.length]! }));
  const totalPaise = data.reduce((sum, s) => sum + s.paise, 0);

  return (
    <section
      className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs"
      aria-labelledby="payment-mix-heading"
    >
      <h2 id="payment-mix-heading" className="font-display text-lg font-semibold text-foreground">
        Payment mix
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">By revenue in the selected range.</p>
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No paid volume in this range.</p>
      ) : (
        <>
          <div className="mt-4 h-52 w-full sm:h-64" role="img" aria-label="Pie chart of revenue by payment method">
            <PaymentPiePlot data={data} />
          </div>
          {/* The legend names every slice in text, so a slice is never identified by colour alone. */}
          <ul className="mt-3 list-none space-y-1.5 p-0 text-sm" aria-label="Payment mix legend">
            {data.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <circle cx="5" cy="5" r="5" fill={s.color} />
                </svg>
                <span className="min-w-0 flex-1 text-foreground">{s.label}</span>
                <span className="shrink-0 tabular-nums text-foreground">{formatINR(s.paise)}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {sharePercent(s.paise, totalPaise)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ChartDataTable caption="Revenue by payment method">
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
      </ChartDataTable>
    </section>
  );
}
