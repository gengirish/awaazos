/**
 * Sorting the everyday menu on the public store page (docs/PRODUCT_PAGE_PLAN.md
 * step 5). Pure and client-safe.
 *
 * 1. Only a catalogue of more than `SORT_MIN_ITEMS - 1` items offers it: with 12 or
 *    fewer a buyer sees everything at a glance. The count is the whole menu on
 *    the page, not what a search leaves, so the control never jumps while typing.
 * 2. "Our order" (the default) is the seller's own: categories, then `sortOrder`,
 *    exactly as the page loaded them. Any other sort shows one list with no
 *    category headings.
 * 3. Price sorts use what the card shows: the lowest size price when the item
 *    has sizes, after the item's sale (`salePriceFor`) when one is live.
 *    "Newest" is `MenuItem.createdAt`, newest first.
 * 4. Every sort is stable: ties keep "Our order".
 * 5. The pick is remembered per store on the device (localStorage, never sent
 *    anywhere). An unknown stored value reads as "Our order".
 */

export const CATALOGUE_SORTS = ["ours", "price_asc", "price_desc", "newest"] as const;
export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

/** The sort control shows from this many items. */
export const SORT_MIN_ITEMS = 13;

export const CATALOGUE_SORT_LABELS: Record<CatalogueSort, string> = {
  ours: "Our order",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  newest: "Newest",
};

export function showsCatalogueSort(itemCount: number): boolean {
  return itemCount >= SORT_MIN_ITEMS;
}

export function parseCatalogueSort(raw: string | null | undefined): CatalogueSort {
  return (CATALOGUE_SORTS as readonly string[]).includes(raw ?? "") ? (raw as CatalogueSort) : "ours";
}

export function catalogueSortStorageKey(slug: string): string {
  return `awz_sort:${slug}`;
}

/** What a sort compares for one item. */
export type SortKey = {
  /** The price the card shows, in paise. */
  pricePaise: number;
  /** `MenuItem.createdAt` in epoch ms. */
  createdAtMs: number;
};

/** `items` in the order `sort` asks for; "ours" returns them as given. Never mutates `items`. */
export function sortCatalogue<T>(items: readonly T[], sort: CatalogueSort, keyOf: (item: T) => SortKey): T[] {
  if (sort === "ours") return [...items];
  const keyed = items.map((item, index) => ({ item, index, key: keyOf(item) }));
  keyed.sort((a, b) => {
    const diff =
      sort === "price_asc"
        ? a.key.pricePaise - b.key.pricePaise
        : sort === "price_desc"
          ? b.key.pricePaise - a.key.pricePaise
          : b.key.createdAtMs - a.key.createdAtMs;
    return diff !== 0 ? diff : a.index - b.index;
  });
  return keyed.map((k) => k.item);
}
