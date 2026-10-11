import type { ReactNode } from "react";

export type KpiCardProps = {
  label: string;
  htmlId: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Accessible description for the value */
  valueLabel?: string;
};

/**
 * One KPI tile. Tiles sit two-up on a phone (~130 px of text width at 360 px),
 * so the label may wrap but the value never truncates: it steps down a size
 * below `sm`, and `wrap-anywhere` lets an amount too long even for that break
 * onto a second line instead of being clipped. `mt-auto` keeps the values of a
 * row on one baseline when one label wraps and its neighbour does not.
 */
export function KpiCard({ label, htmlId, value, sub, valueLabel }: KpiCardProps) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 shadow-xs sm:p-4"
      aria-labelledby={htmlId}
    >
      <h2 id={htmlId} className="text-xs font-medium text-muted-foreground sm:text-sm">
        {label}
      </h2>
      <p
        className="mt-auto pt-1 font-display text-lg font-bold tabular-nums wrap-anywhere text-foreground sm:text-2xl"
        aria-label={valueLabel}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </section>
  );
}
