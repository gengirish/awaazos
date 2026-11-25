"use client";

import { LayoutGrid, Pencil, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import { MenuItemCard, type MenuMoveDirection } from "@/components/menu/MenuItemCard";
import { ReceiveStockDialog, canReceiveStock } from "@/components/menu/ReceiveStockDialog";
import { RenameCategoryDialog } from "@/components/menu/RenameCategoryDialog";
import type { StockSaved } from "@/components/menu/StockStepper";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { RadioOption } from "@/components/ui/radio-option";
import {
  dropWithinCategory,
  groupMenuRows,
  menuCategories,
  menuCategoryOf,
  moveWithinCategory,
} from "@/lib/menu-category";
import {
  MENU_STATUS_LABELS,
  hidesInsideSections,
  isMenuFilterEmpty,
  menuItemMatches,
  menuStatusFilters,
  showsMenuFilter,
  type MenuFilter,
  type MenuStatusFilter,
} from "@/lib/menu-search";
import type { MenuRow } from "@/lib/menu-stock";
import { searchTerms } from "@/lib/store-search";
import type { StoreVocabulary } from "@/lib/store-vocabulary";
import { cn } from "@/lib/utils";

/** The empty state's title: what the seller asked for, in words. */
function noMatchTitle(query: string, status: MenuStatusFilter, category: string | null): string {
  const where = category ? ` in ${category}` : "";
  if (query) return `No items${where} match “${query}”`;
  if (status !== "all") return `No ${MENU_STATUS_LABELS[status].toLowerCase()} items${where}`;
  return `No items${where}`;
}

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
  /** MANAGER and up: the cards offer "Received stock" (lib/stock-purchase.ts rule 2). */
  canSeeCost?: boolean;
  /** The published store's link name, for each card's product link; null = not published. */
  storeSlug?: string | null;
  /** MANAGER and up: each category can be renamed (PATCH /api/menu/categories). */
  canManage?: boolean;
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

export function MenuGrid({
  items,
  setItems,
  initialItems,
  onAdd,
  onEdit,
  vocab,
  canSeeCost = false,
  storeSlug = null,
  canManage = false,
}: MenuGridProps) {
  const router = useRouter();
  const [receiving, setReceiving] = useState<MenuRow | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const categories = useMemo(() => menuCategories(items), [items]);
  const gridRef = useRef<HTMLDivElement>(null);
  // Reorder saves run one at a time; taps made meanwhile collapse into one more save.
  const savingOrder = useRef(false);
  const queuedOrder = useRef<MenuRow[] | null>(null);
  // The Move button to put focus back on once the cards have swapped places.
  const refocusMove = useRef<{ id: string; direction: MenuMoveDirection } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MenuStatusFilter>("all");
  const [category, setCategory] = useState<string | null>(null);

  // One section per category (lib/menu-category.ts); with one category, no sections.
  const sections = useMemo(() => groupMenuRows(items), [items]);
  const sectioned = sections.length > 1;
  // A category renamed or emptied away falls back to every category.
  const shownCategory = sectioned && category && sections.some((s) => s.category === category) ? category : null;
  // Search and the Selling / Sold out filter show from a few items (lib/menu-search.ts).
  // They hide cards; `items` stays the whole menu.
  const searchable = showsMenuFilter(items.length);
  // "Low stock" joins the filter once any item tracks stock; a kitchen sees no change.
  const statusFilters = menuStatusFilters(items.some((item) => item.stockQty !== null));
  const shownStatus = statusFilters.includes(status) ? status : "all";
  const filter = useMemo<MenuFilter>(
    () => ({
      terms: searchable ? searchTerms(query) : [],
      status: searchable ? shownStatus : "all",
      category: shownCategory,
    }),
    [searchable, query, shownStatus, shownCategory],
  );
  const filtering = !isMenuFilterEmpty(filter);
  // Words or a status hide cards inside a section, so moves would jump over them. A category alone doesn't.
  const reorderOff = hidesInsideSections(filter);
  const visibleSections = useMemo(
    () =>
      filtering
        ? sections
            .map((section) => ({ ...section, items: section.items.filter((item) => menuItemMatches(item, filter)) }))
            .filter((section) => section.items.length > 0)
        : sections,
    [sections, filter, filtering],
  );
  const visibleCount = visibleSections.reduce((n, section) => n + section.items.length, 0);
  // Rename is offered for a category the items really carry, not the "General" a blank reads as.
  const renamable = new Set(categories);

  function clearFilter() {
    setQuery("");
    setStatus("all");
    setCategory(null);
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

  // After "Received stock": counts and the cost moved, so read the rows again.
  // Fetched here because router.refresh() beside a save is sometimes not applied.
  const reloadRows = useCallback(async () => {
    try {
      const res = await fetch("/api/menu", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: MenuRow[] };
      if (body.data) setItems(body.data);
    } catch {
      // Offline: the list catches up on the next page load.
    }
  }, [setItems]);

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

  // Cards move inside their own section only (lib/menu-category.ts rule 3).
  function move(item: MenuRow, direction: MenuMoveDirection) {
    const next = moveWithinCategory(items, item.id, direction);
    if (!next) return;
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
    const next = dropWithinCategory(items, dragId, dropId);
    if (next) {
      void applyReorder(next);
      return;
    }
    const dragged = items.find((x) => x.id === dragId);
    const target = items.find((x) => x.id === dropId);
    if (dragged && target && menuCategoryOf(dragged) !== menuCategoryOf(target)) {
      toast.message(`To move ${dragged.name} to ${menuCategoryOf(target)}, change its category in Edit.`, {
        id: "menu-order",
      });
    }
  }

  function renderCards(sectionItems: MenuRow[]) {
    return (
      // grid-cols-1, not an implicit column: that one grows to the longest description line
      // and pushes every card off a 360 px screen (and off-centres dialogs opened over it).
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sectionItems.map((item, index) => (
          <div
            key={item.id}
            draggable={!reorderOff}
            onDragStart={reorderOff ? undefined : (e) => onDragStart(e, item.id)}
            onDragOver={reorderOff ? undefined : onDragOver}
            onDrop={reorderOff ? undefined : (e) => onDrop(e, item.id)}
            className={reorderOff ? undefined : "pointer-fine:cursor-grab pointer-fine:active:cursor-grabbing"}
          >
            <MenuItemCard
              item={item}
              onEdit={onEdit}
              onChanged={refresh}
              onStockSaved={onStockSaved}
              onReceive={canSeeCost && canReceiveStock(item) ? setReceiving : undefined}
              onMove={reorderOff ? undefined : move}
              // With reordering on, every section is shown whole, so its edges are the card's limits.
              canMoveUp={index > 0}
              canMoveDown={index < sectionItems.length - 1}
              storeSlug={storeSlug}
            />
          </div>
        ))}
      </div>
    );
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
            </div>
          ) : null}
          {sectioned ? (
            <div className="space-y-1">
              <p id="menu-category-label" className="text-xs font-medium text-muted-foreground">
                Category
              </p>
              <div role="radiogroup" aria-labelledby="menu-category-label" className="flex flex-wrap gap-2">
                <RadioOption
                  size="compact"
                  name="menu-category"
                  value=""
                  label="All categories"
                  className="px-3"
                  checked={shownCategory === null}
                  onChange={() => setCategory(null)}
                />
                {sections.map((section) => (
                  <RadioOption
                    key={section.category}
                    size="compact"
                    name="menu-category"
                    value={section.category}
                    label={
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{section.category}</span>
                        <span className="font-normal tabular-nums text-muted-foreground">{section.items.length}</span>
                      </span>
                    }
                    className="max-w-full px-3"
                    checked={shownCategory === section.category}
                    onChange={() => setCategory(section.category)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {filtering ? (visibleCount === 1 ? "1 item shown" : `${visibleCount} items shown`) : ""}
          </p>
          {/* With sections, each heading has its own rename button instead. */}
          {canManage && !sectioned && categories.length > 0 ? (
            <section aria-labelledby="menu-categories-heading" className="space-y-2">
              <h2 id="menu-categories-heading" className="text-xs font-medium text-muted-foreground">
                Categories: tap one to rename it
              </h2>
              <ul className="flex flex-wrap gap-2">
                {categories.map((name) => (
                  <li key={name} className="min-w-0 max-w-full">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 min-w-11 max-w-full gap-1.5"
                      aria-label={`Rename category ${name}`}
                      onClick={() => setRenaming(name)}
                    >
                      <span className="truncate">{name}</span>
                      <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {reorderOff ? (
            // A move between two visible cards would jump over hidden ones.
            <p className="text-sm text-muted-foreground">Clear the search to change the order.</p>
          ) : items.length > 1 ? (
            <>
              <p className="text-sm text-muted-foreground pointer-coarse:hidden">
                Drag cards to reorder{sectioned ? " within a category" : ""}. Order is saved when you drop.
              </p>
              <p className="hidden text-sm text-muted-foreground pointer-coarse:block">
                Use the arrows on a card to move it up or down{sectioned ? " within its category" : ""}. The order is
                saved as you go.
              </p>
            </>
          ) : null}
          {visibleCount === 0 ? (
            <EmptyState
              role="status"
              title={noMatchTitle(query.trim(), shownStatus, shownCategory)}
              description="Try another word, or clear the search to see everything."
              action={
                <Button type="button" variant="outline" className="min-h-11" onClick={clearFilter}>
                  Clear search
                </Button>
              }
            />
          ) : sectioned ? (
            <div ref={gridRef} className="space-y-6">
              {visibleSections.map((section, i) => (
                <section key={section.category} aria-labelledby={`menu-section-${i}`} className="space-y-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 id={`menu-section-${i}`} className="min-w-0 truncate font-display text-lg font-semibold">
                      {section.category}
                    </h2>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {section.items.length === 1 ? `1 ${vocab.item}` : `${section.items.length} ${vocab.items}`}
                    </span>
                    {canManage && renamable.has(section.category) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        aria-label={`Rename category ${section.category}`}
                        onClick={() => setRenaming(section.category)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  {renderCards(section.items)}
                </section>
              ))}
            </div>
          ) : (
            <div ref={gridRef}>{renderCards(visibleSections[0]?.items ?? [])}</div>
          )}
        </>
      )}
      <ReceiveStockDialog item={receiving} onClose={() => setReceiving(null)} onSaved={() => void reloadRows()} />
      <RenameCategoryDialog category={renaming} onClose={() => setRenaming(null)} onRenamed={() => void reloadRows()} />
    </div>
  );
}
