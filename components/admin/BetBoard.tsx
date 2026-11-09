import { Target } from "lucide-react";

import { BetForm } from "@/components/admin/BetForm";
import { EmptyState } from "@/components/ui/empty-state";
import {
  BET_METRICS,
  type BetOutput,
  type BetTone,
  DECISION_LABEL,
  type MetricSnapshot,
  betStatus,
  daysLeftLabel,
  formatMetricValue,
  formatTarget,
  isBetMetricKey,
  ymdToDateOnly,
} from "@/lib/admin-bets";
import { formatYmd } from "@/lib/admin-free-access";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<BetTone, string> = { green: "bg-success", amber: "bg-warning", red: "bg-destructive" };
const TONE_TEXT: Record<BetTone, string> = { green: "text-success", amber: "text-warning", red: "text-destructive" };

type Props = { bets: readonly BetOutput[]; snapshot: MetricSnapshot; now: Date };

/**
 * The bets on /admin/bets, each with its status against this week's number
 * (lib/admin-bets.ts). Editing opens the same form in place; nothing autosaves.
 */
export function BetBoard({ bets, snapshot, now }: Props) {
  return (
    <section aria-labelledby="bets-heading" className="space-y-3">
      <div>
        <h2 id="bets-heading" className="font-display text-xl font-semibold text-foreground">
          Bet board
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each bet is checked against its metric over the last 7 complete days. Green: target met now. Amber: not yet,
          deadline ahead. Red: deadline passed without it.
        </p>
      </div>

      {bets.length === 0 ? (
        <EmptyState icon={Target} title="No bets yet" description="Add the first one below." />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {bets.map((bet) => {
            const known = isBetMetricKey(bet.metricKey);
            const metric = known ? BET_METRICS[bet.metricKey as keyof typeof BET_METRICS] : null;
            const value = known ? snapshot[bet.metricKey as keyof typeof BET_METRICS] : null;
            const status = value
              ? betStatus({ value, targetValue: bet.targetValue, comparator: bet.comparator, deadline: ymdToDateOnly(bet.deadline), now })
              : null;
            return (
              <li key={bet.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="break-words font-semibold text-foreground">{bet.title}</h3>
                  {status ? (
                    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", TONE_TEXT[status.tone])}>
                      <span aria-hidden className={cn("size-2.5 rounded-full", TONE_DOT[status.tone])} />
                      {status.label}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unknown metric</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-foreground">{bet.hypothesis}</p>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Target</dt>
                    <dd>
                      {metric
                        ? `${metric.label} ${bet.comparator === "GTE" ? "at least" : "at most"} ${formatTarget(metric.unit, bet.targetValue)}`
                        : bet.metricKey}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last 7 days</dt>
                    <dd className="font-semibold tabular-nums">{value ? formatMetricValue(value) : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">By {formatYmd(bet.deadline)}</dt>
                    <dd>{status ? daysLeftLabel(status.daysLeft) : "–"}</dd>
                  </div>
                </dl>

                <p className="mt-3 text-sm">
                  <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
                    {DECISION_LABEL[bet.decision]}
                  </span>
                </p>
                {bet.notes ? <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{bet.notes}</p> : null}

                <details className="mt-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                    Edit or decide
                  </summary>
                  <div className="pt-2">
                    <BetForm bet={bet} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <details className="rounded-lg border bg-card p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">Add a bet</summary>
        <div className="pt-3">
          <BetForm />
        </div>
      </details>
    </section>
  );
}
