import { describeLastOrder, type StoreHealth } from "@/lib/admin-store-health";
import { formatIstDate } from "@/lib/datetime";

/** Last order · store published or not · drops this week, as one compact row. */
export function StoreHealthLine({ health, now }: { health: StoreHealth; now: Date }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-sm">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">Last order</dt>
        <dd className="font-medium text-foreground">
          {health.lastOrderAt ? (
            <time dateTime={health.lastOrderAt.toISOString()} title={formatIstDate(health.lastOrderAt)}>
              {describeLastOrder(health.lastOrderAt, now)}
            </time>
          ) : (
            describeLastOrder(null, now)
          )}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">Store</dt>
        <dd className="font-medium text-foreground">{health.published ? "Published" : "Not published"}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">Drops this week</dt>
        <dd className="font-medium tabular-nums text-foreground">{health.dropsThisWeek}</dd>
      </div>
    </dl>
  );
}
