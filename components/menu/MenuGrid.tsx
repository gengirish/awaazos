"use client";

import { LayoutGrid, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import { MenuItemCard, type MenuMoveDirection } from "@/components/menu/MenuItemCard";
import type { StockSaved } from "@/components/menu/StockStepper";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { RadioOption } from "@/components/ui/radio-option";
import {
  MENU_STATUS_LABELS,
  isMenuFilterEmpty,
  menuItemMatches,
  menuStatusFilters,
  type MenuStatusFilter,
} from "@/lib/menu-search";
import type { MenuRow } from "@/lib/menu-stock";
import { STAFF_SEARCH_MIN_ITEMS, searchTerms } from "@/lib/store-search";
import type { StoreVocabulary } from "@/lib/store-vocabulary";
import { cn } from "@/lib/utils";


type MenuGridProps = {
  /** The list on screen; MenuScreen owns it because the page header needs it too. */
  items: MenuRow[];
  setItems: Dispatch<SetStateAction<MenuRow[]>>;
  /** What the server last sent: a failed reorder goes back to this. */
  initialItems: MenuRow[];
  onAdd: () => void;
  onEdit: (item: MenuRow) => void;
  /** The store's words (lib/store-vocabulary.ts). */
  vocab: StoreVocabulary;
};

/** One request for the whole order (POST /api/menu/reorder). False when it did not save. */
async function saveOrder(rows: MenuRow[]): Promise<boolean> {
  try {
    const res = await fetch("/api/menu/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: rows.map((row) => row.id) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function MenuGrid({ items, setItems, initialItems, onAdd, onEdit, vocab }: MenuGridProps) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  // Reorder saves run one at a time; taps made meanwhile collapse into one more save.
  const savingOrder = useRef(false);
  const queuedOrder = useRef<MenuRow[] | null>(null);
  // The Move button to put focus back on once the cards have swapped places.
  const refocusMove = useRef<{ id: string; direction: MenuMoveDirection } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MenuStatusFilter>("all");

  // Search and the Selling / Sold out filter only earn their space on a long
  // list (lib/menu-search.ts). They hide cards; `items` stays the whole menu.
  const searchable = items.length > STAFF_SEARCH_MIN_ITEMS;
  // "Low stock" joins the filter once any item tracks stock; a kitchen sees no change.
  const statusFilters = menuStatusFilters(items.some((item) => item.stockQty !== null));
  const shownStatus = statusFilters.includes(status) ? status : "all";
  const filter = useMemo(
    () => (searchable ? { terms: searchTerms(query), status: shownStatus } : { terms: [], status: "all" as const }),
    [searchable, query, shownStatus],
  );
  const filtering = !isMenuFilterEmpty(filter);
  const visibleItems = useMemo(
    () => (filtering ? items.filter((item) => menuItemMatches(item, filter)) : items),
    [items, filter, filtering],
  );

  function clearFilter() {
    setQuery("");
    setStatus("all");
  }

  // Moving a card re-inserts its DOM node, which drops focus in some browsers.
  // At an end of the list that button is now disabled, so its twin takes over.
  useEffect(() => {
    const target = refocusMove.current;
    if (!target) return;
    refocusMove.current = null;
    const button = (direction: MenuMoveDirection) =>
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-move="${target.id}:${direction}"]`);
    const same = button(target.direction);
    (same && !same.disabled ? same : button(target.direction === "up" ? "down" : "up"))?.focus();
  }, [items]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // The card already shows its own figure; this keeps the list (and its filter) in step.
  const onStockSaved = useCallback(
    (id: string, saved: StockSaved) => {
      setItems((rows) => rows.map((row) => (row.id === id ? { ...row, ...saved } : row)));
    },
    [setItems],
  );

  async function applyReorder(next: MenuRow[]) {
    setItems(next);
    if (savingOrder.current) {
      queuedOrder.current = next;
      return;
    }
    savingOrder.current = true;
    let order = next;
    let ok = true;
    try {
      for (;;) {
        ok = await saveOrder(order);
        const queued = queuedOrder.current;
        queuedOrder.current = null;
        if (!ok || !queued) break;
        order = queued;
      }
    } finally {
      savingOrder.current = false;
    }
    if (ok) {
      toast.success("Order updated", { id: "menu-order" });
    } else {
      // Back to what the server has (the refresh below confirms it).
      setItems(initialItems);
      toast.error("Could not save order", { id: "menu-order" });
    }
    refresh();
  }

  function move(item: MenuRow, direction: MenuMoveDirection) {
    const from = items.findIndex((x) => x.id === item.id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    refocusMove.current = { id: item.id, direction };
    void applyReorder(next);
  }

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, dropId: string) {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("text/plain");
    if (!dragId || dragId === dropId) return;
    const from = items.findIndex((x) => x.id === dragId);
    const to = items.findIndex((x) => x.id === dropId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void applyReorder(next);
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        // The only "Add item" on the page while the menu is empty.
        <EmptyState
          icon={LayoutGrid}
          title="No items yet"
          description={`Add your first item here, or use Add ${vocab.items} by voice above to say several with their prices.`}
          action={
            <Button type="button" className="min-h-11" onClick={onAdd}>
              Add item
            </Button>
          }
        />
      ) : (
        <>
          {searchable ? (
            <div className="space-y-2">
              <div>
                <label htmlFor="menu-search" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Search {vocab.catalogue}
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="menu-search"
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setQuery("");
                    }}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
              <div
                role="radiogroup"
                aria-label="Show"
                className={cn(
                  "grid gap-2",
                  statusFilters.length > 3 ? "max-w-lg grid-cols-2 sm:grid-cols-4" : "max-w-sm grid-cols-3",
                )}
              >
                {statusFilters.map((value) => (
                  <RadioOption
                    key={value}
                    size="compact"
                    name="menu-status"
                    value={value}
                    label={MENU_STATUS_LABELS[value]}
                    checked={shownStatus === value}
                    onChange={() => setStatus(value)}
                  />
                ))}
              </div>
              <p aria-live="polite" className="sr-only">
                {filtering ? (visibleItems.length === 1 ? "1 item shown" : `${visibleItems.length} items shown`) : ""}
              </p>
            </div>
          ) : null}
          {filtering ? (
            // A move between two visible cards would jump over hidden ones.
            <p className="text-sm text-muted-foreground">Clear the search to change the order.</p>
          ) : items.length > 1 ? (
            <>
              <p className="text-sm text-muted-foreground pointer-coarse:hidden">
                Drag cards to reorder. Order is saved when you drop.
              </p>
              <p className="hidden text-sm text-muted-foreground pointer-coarse:block">
                Use the arrows on a card to move it up or down. The order is saved as you go.
              </p>
            </>
          ) : null}
          {visibleItems.length === 0 ? (
            <EmptyState
              role="status"
              title={query.trim() ? `No items match “${query.trim()}”` : `No ${MENU_STATUS_LABELS[shownStatus].toLowerCase()} items`}
              description="Try another word, or clear the search to see everything."
              action={
                <Button type="button" variant="outline" className="min-h-11" onClick={clearFilter}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <div ref={gridRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleItems.map((item, index) => (
                <div
                  key={item.id}
                  draggable={!filtering}
                  onDragStart={filtering ? undefined : (e) => onDragStart(e, item.id)}
                  onDragOver={filtering ? undefined : onDragOver}
                  onDrop={filtering ? undefined : (e) => onDrop(e, item.id)}
                  className={filtering ? undefined : "pointer-fine:cursor-grab pointer-fine:active:cursor-grabbing"}
                >
                  <MenuItemCard
                    item={item}
                    onEdit={onEdit}
                    onChanged={refresh}
                    onStockSaved={onStockSaved}
                    onMove={filtering ? undefined : move}
                    canMoveUp={index > 0}
                    canMoveDown={index < items.length - 1}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
