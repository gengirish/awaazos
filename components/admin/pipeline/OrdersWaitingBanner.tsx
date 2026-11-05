import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Pinned above everything: a real buyer has ordered from a store nobody owns yet. */
export function OrdersWaitingBanner({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary p-4 text-primary-foreground"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <ShoppingBag aria-hidden className="size-5 shrink-0" />
        <span>
          <strong>
            {count === 1 ? "1 store has orders but no owner" : `${count} stores have orders but no owner`}
          </strong>
          <span className="block sm:inline">
            <span aria-hidden className="hidden sm:inline">
              {" · "}
            </span>
            Claim pitch ready
          </span>
        </span>
      </p>
      <Button type="button" size="sm" variant="secondary" onClick={onToggle}>
        {active ? "Show the whole queue" : count === 1 ? "Show this store" : "Show these stores"}
      </Button>
    </div>
  );
}
