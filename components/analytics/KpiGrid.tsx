import { formatINR } from "@/lib/currency";

import { KpiCard } from "./KpiCard";

export type KpiGridProps = {
  revenueLabel: string;
  totalRevenuePaise: number;
  totalTransactions: number;
  avgTicketPaise: number;
  totalItemsSold: number;
  hasSales: boolean;
};

export function KpiGrid({
  revenueLabel,
  totalRevenuePaise,
  totalTransactions,
  avgTicketPaise,
  totalItemsSold,
  hasSales,
}: KpiGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        htmlId="kpi-revenue"
        label={revenueLabel}
        value={formatINR(totalRevenuePaise)}
        valueLabel={`${revenueLabel}: ${formatINR(totalRevenuePaise)}`}
      />
      <KpiCard
        htmlId="kpi-txns"
        label="Total transactions"
        value={totalTransactions}
        valueLabel={`Total transactions: ${totalTransactions}`}
      />
      <KpiCard
        htmlId="kpi-avg"
        label="Average ticket size"
        value={hasSales ? formatINR(avgTicketPaise) : "—"}
        valueLabel={hasSales ? `Average ticket: ${formatINR(avgTicketPaise)}` : "No transactions in range"}
      />
      <KpiCard
        htmlId="kpi-items"
        label="Items sold"
        value={totalItemsSold}
        valueLabel={`Items sold: ${totalItemsSold}`}
      />
    </div>
  );
}
