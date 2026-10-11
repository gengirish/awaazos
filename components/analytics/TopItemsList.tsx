import { formatINR } from "@/lib/currency";

export type TopItemRow = {
  rank: number;
  name: string;
  qty: number;
  revenuePaise: number;
  emoji: string | null;
};

export type TopItemsListProps = {
  items: TopItemRow[];
  maxQty: number;
};

export function TopItemsList({ items, maxQty }: TopItemsListProps) {
  const denom = Math.max(1, maxQty);

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs" aria-labelledby="top-items-heading">
      <h2 id="top-items-heading" className="font-display text-lg font-semibold text-foreground">
        Best-selling items
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Top 10 by quantity sold (name at time of sale).</p>
      <ul className="mt-4 list-none space-y-4 p-0" role="list">
        {items.length === 0 ? (
          <li className="text-sm text-muted-foreground">No line items in this range.</li>
        ) : (
          items.map((item) => {
            const widthPct = Math.round((item.qty / denom) * 100);
            return (
              <li key={`${item.rank}-${item.name}`}>
                <div className="flex items-baseline gap-2">
                  <span className="w-6 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">{item.rank}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                      <span className="truncate font-medium text-foreground">{item.name}</span>
                    </div>
                    <div
                      className="mt-1 h-2 max-w-full rounded-full bg-muted"
                      role="presentation"
                      aria-hidden
                    >
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${widthPct}%`, minWidth: item.qty > 0 ? "4px" : 0 }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {item.qty} sold · {formatINR(item.revenuePaise)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
