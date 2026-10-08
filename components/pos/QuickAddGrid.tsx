"use client";

import Image from "next/image";
import Link from "next/link";
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
  /** Optional photo. Absent (or null) falls back to `emoji`. */
  imageUrl?: string | null;
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
      <section
        aria-labelledby="quick-add-heading"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center"
      >
        <h2 id="quick-add-heading" className="font-display text-lg font-semibold text-foreground">
          No items yet
        </h2>
        <p className="text-sm text-muted-foreground">
          Add menu items so cashiers can tap or speak them into the cart.
        </p>
        <Link
          href="/menu"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Open menu &rarr;
        </Link>
        <p className="text-xs text-muted-foreground">
          Tip: items marked unavailable on /menu will not appear here.
        </p>
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
                  {/*
                    Decorative on purpose. This button has no aria-label, so its
                    accessible name is computed from its text content —
                    "{name} {formatINR(price)}", which e2e/pos-ui.spec.ts selects
                    by. An empty alt (plus aria-hidden) keeps the photo out of
                    that name, exactly as the emoji span already is.
                    40px thumbnails keep the grid cheap on metered mobile data.
                  */}
                  {it.imageUrl ? (
                    <Image
                      src={it.imageUrl}
                      alt=""
                      aria-hidden
                      width={40}
                      height={40}
                      sizes="40px"
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  ) : (
                    <span className="text-2xl leading-none" aria-hidden>
                      {it.emoji}
                    </span>
                  )}
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
