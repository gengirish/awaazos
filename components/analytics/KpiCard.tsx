import type { ReactNode } from "react";

export type KpiCardProps = {
  label: string;
  htmlId: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Accessible description for the value */
  valueLabel?: string;
};

export function KpiCard({ label, htmlId, value, sub, valueLabel }: KpiCardProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby={htmlId}>
      <h2 id={htmlId} className="text-sm font-medium text-muted-foreground">
        {label}
      </h2>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground" aria-label={valueLabel}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </section>
  );
}
