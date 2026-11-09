import { Store } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import type { ActivationFunnel, ActivationRow } from "@/lib/activation-funnel";
import { stepRate } from "@/lib/order-funnel";

function Count({ count, of }: { count: number; of: number }) {
  const rate = stepRate(count, of);
  return (
    <td className="px-2 py-2 text-right align-top tabular-nums">
      <span className="font-semibold text-foreground">{count.toLocaleString("en-IN")}</span>
      {rate ? <span className="block text-xs text-muted-foreground">{rate}</span> : null}
    </td>
  );
}

function Row({ row, total = false }: { row: ActivationRow; total?: boolean }) {
  return (
    <tr className={total ? "border-t-2" : "border-t"}>
      <th scope="row" className="py-2 pr-2 text-left align-top font-medium text-foreground">
        {row.city}
      </th>
      <td className="px-2 py-2 text-right align-top font-semibold tabular-nums text-foreground">
        {row.created.toLocaleString("en-IN")}
      </td>
      <Count count={row.claimed} of={row.created} />
      <Count count={row.paid} of={row.claimed} />
    </tr>
  );
}

/** Demo store → claimed → first paid bill, by city (lib/activation-funnel.ts). */
export function ActivationFunnelTable({ funnel }: { funnel: ActivationFunnel }) {
  return (
    <section aria-labelledby="activation-heading" className="space-y-3">
      <div>
        <h2 id="activation-heading" className="font-display text-xl font-semibold text-foreground">
          Activation by city
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every demo store built so far: how many sellers claimed theirs, and how many of those then took a paid bill.
          The small figure is the share of the column before.
        </p>
      </div>
      {funnel.rows.length === 0 ? (
        <EmptyState icon={Store} title="No demo stores yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card p-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Demo stores created, claimed and with a first paid bill, by city</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 pr-2 text-left font-medium">
                  City
                </th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">
                  Demo stores
                </th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">
                  Claimed
                </th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">
                  First paid bill
                </th>
              </tr>
            </thead>
            <tbody>
              {funnel.rows.map((r) => (
                <Row key={r.city} row={r} />
              ))}
              {funnel.rows.length > 1 ? <Row row={funnel.total} total /> : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
