"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";
import { cn } from "@/lib/utils";

export type MenuTile = {
  id: string;
  name: string;
  emoji: string;
  priceInPaise: number;
  isPopular: boolean;
  category: string;
};

export type QuickAddGridProps = {
  items: MenuTile[];
};

type ItemGroup = { category: string | null; items: MenuTile[] };

export function QuickAddGrid({ items }: QuickAddGridProps) {
  const addItem = useCartStore((s) => s.addItem);

  const grouped = useMemo((): ItemGroup[] => {
    if (items.length <= 8) {
      return [{ category: null as string | null, items }];
    }
    const byCat = new Map<string, MenuTile[]>();
    for (const it of items) {
      const c = it.category || "General";
      const list = byCat.get(c) ?? [];
      list.push(it);
      byCat.set(c, list);
    }
    return Array.from(byCat.entries()).map(([category, groupItems]) => ({ category, items: groupItems }));
  }, [items]);

  if (items.length === 0) {
    return (
      <section aria-labelledby="quick-add-heading" className="rounded-lg border border-dashed p-6 text-center">
        <h2 id="quick-add-heading" className="font-display text-lg font-semibold text-foreground">
          No items yet
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Add menu items to use Quick Add.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="quick-add-heading">
      <h2 id="quick-add-heading" className="mb-3 font-display text-lg font-semibold text-foreground">
        Quick add
      </h2>
      <div className="space-y-6">
        {grouped.map((group) => (
          <div key={group.category ?? "all"}>
            {group.category ? (
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{group.category}</h3>
            ) : null}
            <div
              className={cn(
                "grid gap-2",
                "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
              )}
            >
              {group.items.map((it) => (
                <Button
                  key={it.id}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-[72px] flex-col gap-1 py-3 text-left font-normal"
                  onClick={() =>
                    addItem({
                      menuItemId: it.id,
                      name: it.name,
                      emoji: it.emoji,
                      priceInPaise: it.priceInPaise,
                    })
                  }
                >
                  <span className="text-2xl leading-none" aria-hidden>
                    {it.emoji}
                  </span>
                  <span className="line-clamp-2 w-full text-center text-sm font-medium text-foreground">
                    {it.name}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatINR(it.priceInPaise)}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
