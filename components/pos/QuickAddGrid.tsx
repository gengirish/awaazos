"use client";

import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { SizePickerDialog, type PosSize } from "@/components/pos/SizePickerDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";
import { stockLabel } from "@/lib/inventory";
import { variantLineName, variantPriceRange } from "@/lib/item-variants";
import { STAFF_SEARCH_MIN_ITEMS, itemSearchText, matchesSearch, searchTerms } from "@/lib/store-search";
import type { StoreVocabulary } from "@/lib/store-vocabulary";
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
  /** Voice spellings ("bhel" for "Bhel Puri"); the search matches them too. */
  aliases?: string[];
  /**
   * Stock left for a tracked item (lib/inventory.ts), absent or null when not
   * tracked. Display only: the counter never refuses a sale over stock (rule 5).
   */
  stockLeft?: number | null;
  lowStockAt?: number | null;
  /**
   * Its available sizes or colours (lib/item-variants.ts), absent or empty for an
   * item without. A tile with sizes opens the size picker instead of adding.
   */
  sizes?: PosSize[];
};

export type QuickAddGridProps = {
  items: MenuTile[];
  /** The store's words (lib/store-vocabulary.ts): "Menu" or "Products". */
  vocab: StoreVocabulary;
};

type ItemGroup = { category: string | null; items: MenuTile[] };

/** Group tiles by category above this many items (unchanged from before). */
const GROUP_THRESHOLD = 8;
/** Hold this long on a tile to take one off instead of adding one. */
const LONG_PRESS_MS = 500;
/** A finger drifting further than this is a scroll, not a press. */
const MOVE_CANCEL_PX = 10;

const TILE_HINT = "Tap to add one · press and hold to remove one";

function categoryOf(it: MenuTile): string {
  return it.category || "General";
}

function groupByCategory(items: MenuTile[]): ItemGroup[] {
  const byCat = new Map<string, MenuTile[]>();
  for (const it of items) {
    const c = categoryOf(it);
    const list = byCat.get(c) ?? [];
    list.push(it);
    byCat.set(c, list);
  }
  return Array.from(byCat.entries()).map(([category, groupItems]) => ({ category, items: groupItems }));
}

export function QuickAddGrid({ items, vocab }: QuickAddGridProps) {
  const cartItems = useCartStore((s) => s.items);
  const [query, setQuery] = useState("");
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [sizing, setSizing] = useState<MenuTile | null>(null);
  const addItem = useCartStore((s) => s.addItem);

  // Per item, all its sizes together (the tile's badge); and per size (the picker).
  const { qtyById, qtyByVariant } = useMemo(() => {
    const byItem = new Map<string, number>();
    const byVariant = new Map<string, number>();
    for (const line of cartItems) {
      byItem.set(line.menuItemId, (byItem.get(line.menuItemId) ?? 0) + line.qty);
      if (line.variantId) byVariant.set(line.variantId, line.qty);
    }
    return { qtyById: byItem, qtyByVariant: byVariant };
  }, [cartItems]);

  // Category chips and search only earn their space on a long menu.
  const searchable = items.length > STAFF_SEARCH_MIN_ITEMS;
  const grouped = items.length > GROUP_THRESHOLD;

  // Stable DOM ids per category, from the full menu so they don't shift while filtering.
  const categoryIds = useMemo(() => {
    const ids = new Map<string, string>();
    for (const it of items) {
      const c = categoryOf(it);
      if (!ids.has(c)) ids.set(c, `quick-add-cat-${ids.size}`);
    }
    return ids;
  }, [items]);

  // Same matcher as the store page and /menu (lib/store-search.ts): every word, any order.
  const terms = useMemo(() => (searchable ? searchTerms(query) : []), [searchable, query]);

  const visibleItems = useMemo(() => {
    if (terms.length === 0) return items;
    return items.filter((it) => matchesSearch(itemSearchText(it, categoryOf(it)), terms));
  }, [items, terms]);

  const groups = useMemo((): ItemGroup[] => {
    if (!grouped) return [{ category: null, items: visibleItems }];
    return groupByCategory(visibleItems);
  }, [grouped, visibleItems]);

  // A chip tapped mid-search clears the filter first; scroll once its section is back.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.getElementById(pendingScroll);
    if (el) {
      const reduce =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
    setPendingScroll(null);
  }, [pendingScroll, groups]);

  if (items.length === 0) {
    return (
      <EmptyState
        as="section"
        aria-labelledby="quick-add-heading"
        title="No items yet"
        titleAs="h2"
        titleId="quick-add-heading"
        description={`Add ${vocab.kind === "food" ? "menu items" : vocab.items} so cashiers can tap or speak them into the cart.`}
        action={
          <Link
            href="/menu"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Open {vocab.catalogueTitle} &rarr;
          </Link>
        }
      >
        <p className="text-xs text-muted-foreground">
          Tip: items marked sold out in {vocab.catalogueTitle} will not appear here.
        </p>
      </EmptyState>
    );
  }

  const categories = Array.from(categoryIds.keys());

  return (
    <section aria-labelledby="quick-add-heading">
      <h2 id="quick-add-heading" className="font-display text-lg font-semibold text-foreground">
        Quick add
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">{TILE_HINT}</p>

      {searchable ? (
        <div className="mb-4 space-y-2">
          <div>
            <label htmlFor="quick-add-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              Search {vocab.catalogue}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="quick-add-search"
                type="search"
                inputMode="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 pl-9"
              />
            </div>
          </div>
          {categories.length > 1 ? (
            <div
              role="group"
              aria-label={`${vocab.catalogueTitle} categories`}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin"
            >
              {categories.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-11 shrink-0 rounded-full px-4"
                  aria-label={`Jump to ${c}`}
                  onClick={() => {
                    setQuery("");
                    setPendingScroll(categoryIds.get(c) ?? null);
                  }}
                >
                  {c}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <EmptyState role="status" description={<>No items match &ldquo;{query.trim()}&rdquo;.</>} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div
              key={group.category ?? "all"}
              id={group.category ? categoryIds.get(group.category) : undefined}
              className="scroll-mt-4"
            >
              {group.category ? (
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{group.category}</h3>
              ) : null}
              <div className={cn("grid gap-2", "grid-cols-2 sm:grid-cols-3 md:grid-cols-4")}>
                {group.items.map((it) => (
                  <QuickAddTile key={it.id} item={it} qty={qtyById.get(it.id) ?? 0} onPickSize={setSizing} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <SizePickerDialog
        item={sizing && sizing.sizes ? { name: sizing.name, sizes: sizing.sizes } : null}
        qtyByVariant={qtyByVariant}
        onClose={() => setSizing(null)}
        onPick={(size) => {
          if (!sizing) return;
          addItem({
            menuItemId: sizing.id,
            variantId: size.id,
            name: variantLineName(sizing.name, size.label),
            emoji: sizing.emoji,
            priceInPaise: size.priceInPaise,
          });
          setSizing(null);
        }}
      />
    </section>
  );
}

function QuickAddTile({
  item: it,
  qty,
  onPickSize,
}: {
  item: MenuTile;
  qty: number;
  onPickSize: (item: MenuTile) => void;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const decQty = useCartStore((s) => s.decQty);

  const [pressing, setPressing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  /** Set when a long-press fired, so the click that follows pointerup is swallowed. */
  const longPressedRef = useRef(false);
  /** Latest qty, read at pointerdown: with nothing in the cart a long-press has nothing to take off. */
  const qtyRef = useRef(qty);
  qtyRef.current = qty;
  const sizes = it.sizes ?? [];
  const sized = sizes.length > 0;

  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    setPressing(false);
  };

  // Unmount mid-press (e.g. a search filters the tile away): drop the timer.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    // Not in the cart: arm no timer, so a slow tap still adds instead of being swallowed.
    // With sizes there is no one line to take off: the cart's minus does that.
    if (qtyRef.current === 0 || sized) return;
    setPressing(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressedRef.current = true;
      setPressing(false);
      decQty(it.id);
      try {
        navigator.vibrate?.(15);
      } catch {
        // Haptics are a nicety; some browsers throw outside a user gesture.
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    if (!start || !timerRef.current) return;
    if (Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX || Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX) {
      cancelPress();
    }
  };

  const inCart = qty > 0;
  const stock = sized ? null : stockLabel(it.stockLeft ?? null, it.lowStockAt ?? null);
  const stockShort = !sized && it.stockLeft != null && it.stockLeft <= 0;
  const range = sized ? variantPriceRange(it.priceInPaise, sizes.map((s) => ({ priceInPaise: s.priceInPaise }))) : null;
  const priceText = range ? `from ${formatINR(range.minPaise)}` : formatINR(sized ? sizes[0]!.priceInPaise : it.priceInPaise);

  return (
    <Button
      type="button"
      variant="outline"
      title={sized ? "Tap to pick a size or colour" : TILE_HINT}
      className={cn(
        "relative h-auto min-h-[72px] touch-manipulation select-none flex-col gap-1 py-3 text-left font-normal [-webkit-touch-callout:none]",
        "motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-95",
        inCart && "border-2 border-primary bg-primary/5",
        pressing && "ring-2 ring-destructive ring-offset-1 motion-safe:scale-95",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        const swallow = longPressedRef.current && e.detail !== 0; // detail 0 = keyboard activation
        longPressedRef.current = false;
        if (swallow) return;
        if (sized) {
          onPickSize(it);
          return;
        }
        addItem({
          menuItemId: it.id,
          name: it.name,
          emoji: it.emoji,
          priceInPaise: it.priceInPaise,
        });
      }}
    >
      {/*
        Decorative on purpose. This button has no aria-label, so its
        accessible name is computed from its text content —
        "{name} {formatINR(price)}", which e2e/pos-ui.spec.ts selects
        by (anchored on the name). An empty alt (plus aria-hidden) keeps
        the photo out of that name, exactly as the emoji span already is.
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
          className="pointer-events-none h-10 w-10 rounded-md object-cover"
          draggable={false}
        />
      ) : (
        <span className="text-2xl leading-none" aria-hidden>
          {it.emoji}
        </span>
      )}
      <span className="line-clamp-2 w-full whitespace-normal break-words text-center text-sm font-medium text-foreground">{it.name}</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{priceText}</span>
      {sized ? (
        <span className="text-xs text-muted-foreground">
          {sizes.length === 1 ? sizes[0]!.label : `${sizes.length} options`}
        </span>
      ) : null}
      {stock ? (
        // After the price, so the accessible name still starts with "{name} {price}".
        <span className={cn("text-xs text-muted-foreground", stockShort && "font-semibold text-destructive")}>{stock}</span>
      ) : null}
      {inCart ? (
        <>
          {/* After name and price, so the accessible name still starts with the item name. */}
          <span className="sr-only">, {qty} in cart</span>
          <span
            key={qty}
            aria-hidden
            className="absolute right-1.5 top-1.5 min-w-7 rounded-full bg-primary px-1.5 py-0.5 text-center font-mono text-xs font-bold tabular-nums text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200"
          >
            ×{qty}
          </span>
        </>
      ) : null}
    </Button>
  );
}
