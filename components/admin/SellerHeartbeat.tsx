import Link from "next/link";
import { Activity } from "lucide-react";

import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { Sparkline } from "@/components/admin/Sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { formatINR } from "@/lib/currency";
import {
  BADGE_LABEL,
  HEARTBEAT_BADGES,
  type HeartbeatBadge,
  type HeartbeatRow,
  SPARK_DAYS,
} from "@/lib/seller-heartbeat";
import { cn } from "@/lib/utils";

const BADGE_CLASS: Record<HeartbeatBadge, string> = {
  at_risk: "border-destructive text-destructive",
  watch: "border-warning text-warning",
  new: "border-primary text-primary",
  healthy: "border-success text-success",
};

const ONE_DECIMAL = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function lastPaidLabel(daysIdle: number | null): string {
  if (daysIdle === null) return "Never paid";
  if (daysIdle === 0) return "Paid today";
  if (daysIdle === 1) return "Last paid yesterday";
  return `Last paid ${daysIdle} days ago`;
}

function sparkLabel(spark: readonly number[]): string {
  const total = spark.reduce((a, b) => a + b, 0);
  return `Paid bills per day over the last ${SPARK_DAYS} days: ${total} in all, ${spark.join(", ")}`;
}

type Props = {
  rows: readonly HeartbeatRow[];
  counts: Record<HeartbeatBadge, number>;
  filter: HeartbeatBadge | null;
  /** Prefilled Nudge text per row id; null when the viewer may not see contacts. */
  messages: Record<string, string> | null;
  /** /admin/metrics with this filter, keeping the page's other query params. */
  hrefFor: (badge: HeartbeatBadge | null) => string;
};

/**
 * One row per real store on /admin/metrics, riskiest first (lib/seller-heartbeat.ts).
 * The badge filter is a link (`?badge=`), so it works without client code.
 */
export function SellerHeartbeat({ rows, counts, filter, messages, hrefFor }: Props) {
  const total = HEARTBEAT_BADGES.reduce((sum, b) => sum + counts[b], 0);
  const shown = filter ? rows.filter((r) => r.badge === filter) : rows;
  const chips: { key: HeartbeatBadge | null; label: string; count: number }[] = [
    { key: null, label: "All", count: total },
    ...HEARTBEAT_BADGES.map((b) => ({ key: b, label: BADGE_LABEL[b], count: counts[b] })),
  ];

  return (
    <section aria-labelledby="heartbeat-heading" className="space-y-3">
      <div>
        <h2 id="heartbeat-heading" className="font-display text-xl font-semibold text-foreground">
          Seller heartbeat
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every live store, riskiest first. Bars are paid bills per day over the {SPARK_DAYS} days before today.
        </p>
      </div>

      <nav aria-label="Filter sellers by badge" className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = c.key === filter;
          return (
            <Link
              key={c.label}
              href={hrefFor(c.key)}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground",
              )}
            >
              {c.label} <span className="ml-1 tabular-nums">{c.count}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={total === 0 ? "No live stores yet" : `No sellers are ${BADGE_LABEL[filter!].toLowerCase()} right now`}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((row) => (
            <li key={row.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-foreground">{row.name}</p>
                  <p className="text-xs text-muted-foreground">/s/{row.slug}</p>
                </div>
                <span
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", BADGE_CLASS[row.badge])}
                >
                  {BADGE_LABEL[row.badge]}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <Sparkline values={row.spark} label={sparkLabel(row.spark)} />
                <p className="text-sm text-foreground">{lastPaidLabel(row.daysIdle)}</p>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Sales, 7 days</dt>
                  <dd className="font-semibold tabular-nums">{formatINR(row.gmv7dPaise)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Paid bills, 7 days</dt>
                  <dd className="font-semibold tabular-nums">
                    {row.bills7d} <span className="font-normal text-muted-foreground">(was {row.billsPrior7d})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Voice share</dt>
                  <dd className="font-semibold tabular-nums">
                    {row.voiceShare7d === null ? "–" : `${ONE_DECIMAL.format(row.voiceShare7d * 100)}%`}
                  </dd>
                </div>
              </dl>

              {messages ? (
                <details className="mt-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                    Nudge on WhatsApp
                  </summary>
                  <div className="pt-2">
                    <OutreachWhatsApp phone={row.phone} message={messages[row.id] ?? ""} label="Open WhatsApp" />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
