"use client";

import { ArrowDownUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Searchable } from "@/components/storefront/StoreSearch";
import { RadioOption } from "@/components/ui/radio-option";
import {
  CATALOGUE_SORT_LABELS,
  CATALOGUE_SORTS,
  catalogueSortStorageKey,
  parseCatalogueSort,
  sortCatalogue,
  type CatalogueSort,
  type SortKey,
} from "@/lib/catalogue-sort";

/**
 * The store page's sort (rules in lib/catalogue-sort.ts). One hook holds the
 * buyer's pick for a store, remembered on the device; while a sort other than
 * "Our order" is on, `<html data-catalogue-sorted>` hides the jump bar's category
 * links, since the list has no category headings to jump to.
 */
export function useCatalogueSort(slug: string, enabled: boolean): [CatalogueSort, (next: CatalogueSort) => void] {
  const [sort, setSortState] = useState<CatalogueSort>("ours");

  // Read after mount: the server render is always "Our order", so hydration matches.
  useEffect(() => {
    if (!enabled) return;
    try {
      setSortState(parseCatalogueSort(window.localStorage.getItem(catalogueSortStorageKey(slug))));
    } catch {
      // Storage blocked (private mode): the sort just isn't remembered.
    }
  }, [slug, enabled]);

  const active = enabled ? sort : "ours";
  useEffect(() => {
    const root = document.documentElement;
    if (active === "ours") delete root.dataset.catalogueSorted;
    else root.dataset.catalogueSorted = "";
    return () => {
      delete root.dataset.catalogueSorted;
    };
  }, [active]);

  const setSort = (next: CatalogueSort) => {
    setSortState(next);
    try {
      if (next === "ours") window.localStorage.removeItem(catalogueSortStorageKey(slug));
      else window.localStorage.setItem(catalogueSortStorageKey(slug), next);
    } catch {
      // Not remembered; the pick still applies on this page.
    }
  };
  return [active, setSort];
}

/** The pick-one row above the menu: "Our order", the two price sorts, "Newest". */
export function CatalogueSortControl({
  value,
  onChange,
}: {
  value: CatalogueSort;
  onChange: (next: CatalogueSort) => void;
}) {
  return (
    <fieldset className="mb-5 min-w-0">
      <legend className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
        Sort
      </legend>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {CATALOGUE_SORTS.map((s) => (
          <RadioOption
            key={s}
            size="compact"
            name="catalogue-sort"
            value={s}
            checked={value === s}
            onChange={() => onChange(s)}
            label={CATALOGUE_SORT_LABELS[s]}
            className="shrink-0 whitespace-nowrap px-3"
          />
        ))}
      </div>
    </fieldset>
  );
}

/** A category's heading row: name, rule, item count. Shared by the orderable and read-only menus. */
export function CategoryHeading({ id, category, count }: { id: string; category: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h3 id={id} className="scroll-mt-20 font-display text-base font-bold text-awaaz-charcoal">
        {category}
      </h3>
      <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
      <span className="text-xs font-semibold text-muted-foreground">{count}</span>
    </div>
  );
}

export type SortableRow = {
  id: string;
  key: SortKey;
  /** The row's search text (`menuItemSearchText`). */
  text: string;
  /** The rendered row (`ReadOnlyMenuRow`). */
  node: ReactNode;
};

/**
 * The read-only menu (`acceptMenuOrders` off), by category or, once the buyer
 * picks a sort, as one list. The rows are rendered on the server and only moved here.
 */
export function SortableReadOnlyMenu({
  slug,
  categories,
  listClassName,
  sortable,
}: {
  slug: string;
  categories: { category: string; anchor: string; rows: SortableRow[] }[];
  listClassName: string;
  /** More than 12 items (`showsCatalogueSort`). */
  sortable: boolean;
}) {
  const [sort, setSort] = useCatalogueSort(slug, sortable);
  const control = sortable ? <CatalogueSortControl value={sort} onChange={setSort} /> : null;
  const row = (r: SortableRow) => (
    <Searchable key={r.id} texts={[r.text]}>
      {r.node}
    </Searchable>
  );

  if (sort !== "ours") {
    const rows = sortCatalogue(
      categories.flatMap((c) => c.rows),
      sort,
      (r) => r.key,
    );
    return (
      <>
        {control}
        <Searchable texts={rows.map((r) => r.text)}>
          <section aria-label={`All items, ${CATALOGUE_SORT_LABELS[sort].toLowerCase()}`}>
            <ul className={listClassName}>{rows.map(row)}</ul>
          </section>
        </Searchable>
      </>
    );
  }
  return (
    <>
      {control}
      {categories.map(({ category, anchor, rows }) => (
        <Searchable key={anchor} texts={rows.map((r) => r.text)}>
          <section aria-labelledby={anchor}>
            <CategoryHeading id={anchor} category={category} count={rows.length} />
            <ul className={listClassName}>{rows.map(row)}</ul>
          </section>
        </Searchable>
      ))}
    </>
  );
}
