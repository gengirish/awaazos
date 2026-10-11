import { PaymentMethodBadge, PaymentStatusBadge } from "@/components/transactions/payment-badges";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import type { TransactionListRow } from "@/lib/transactions-list";

type Props = {
  items: TransactionListRow[];
  onOpen: (row: TransactionListRow) => void;
  className?: string;
};

/**
 * The phone layout of the transactions list: one full-width button per bill.
 * Bill number and total share the first line (the number truncates, the total
 * never does); date, item count, method and status wrap underneath.
 */
export function TransactionCardList({ items, onOpen, className }: Props) {
  return (
    <ul aria-label="Transactions" data-testid="transaction-cards" className={className}>
      {items.map((row) => {
        const qty = row.orderItems.reduce((s, o) => s + o.qty, 0);
        return (
          <li key={row.id} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(row)}
              aria-haspopup="dialog"
              className="flex min-h-16 w-full flex-col justify-center gap-1.5 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-muted"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-sm text-foreground">{row.billNumber}</span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-foreground">
                  {formatINR(row.totalPaise)}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <span className="text-xs text-muted-foreground">
                  <span className="whitespace-nowrap tabular-nums">{formatIstDateTime(row.createdAt)}</span>
                  {" · "}
                  <span className="whitespace-nowrap">
                    {qty} {qty === 1 ? "item" : "items"}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <PaymentMethodBadge method={row.paymentMethod} />
                  <PaymentStatusBadge status={row.paymentStatus} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
