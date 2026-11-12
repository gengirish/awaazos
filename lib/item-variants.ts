/**
 * Sizes and colours of one product (`ItemVariant`): "Cotton kurti" in S / M / L.
 * Pure and client-safe, with no zod (the store page imports it); the request
 * schema is lib/item-variants-schema.ts. The plan is docs/INVENTORY_PLAN.md
 * (phase 2). Read this before touching variants anywhere.
 *
 * Rules:
 *
 *   1. Opt-in per item, goods stores only in the seller's UI. An item without
 *      variants behaves exactly as before.
 *   2. An item with variants is ordered by variant. Every storefront line for it
 *      names one of its available variants (`size_required` otherwise), and the
 *      OrderItem keeps `variantId` plus the name snapshot "Cotton kurti – M"
 *      (`variantLineName`), so old bills read right after a rename or delete.
 *   3. Price: the variant's `priceInPaise`, else the item's. Offers treat a
 *      variant as its item (eligibility, tags, "at least N"), at the variant's price.
 *   4. Stock is per variant, with the item's rules (lib/inventory.ts): the count
 *      is `ItemVariant.stockQty` at `stockCountedAt`, left is derived from
 *      OrderItems with that `variantId`, online orders lock the tracked variant
 *      rows (`FOR UPDATE`, id order) and refuse a shortfall. An item with variants
 *      keeps no stock of its own (`MenuItem.stockQty` null).
 *   5. Not yet: drops (an item with variants can't be added to a drop, and an item
 *      in a drop that hasn't ended can't get variants), free gifts (an offer whose
 *      gift has variants is skipped) and order again.
 *   6. The counter (POS) sells by size too: a tile with sizes opens a picker,
 *      the cart line is keyed `itemId:variantId` (`cartLineKey`), priced and
 *      named by rule 2–3, and `POST /api/transactions` records `variantId` once
 *      it is checked to be this vendor's size of that item (else 400
 *      `size_not_found`; a queued offline sale keeps the line without it). As
 *      with items, the counter never refuses over stock, nor a line without a
 *      size (an old till copy). Voice can't pick a size: it leaves such items
 *      out and asks the cashier to tap them.
 */

/** Most variants one item can have. */
export const MAX_VARIANTS_PER_ITEM = 20;
/** Longest variant label ("Red / XL"). */
export const VARIANT_LABEL_MAX = 30;

/** Trimmed, inner whitespace collapsed. */
export function normaliseVariantLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** What a variant sells for (rule 3). */
export function variantPricePaise(itemPricePaise: number, variant: { priceInPaise: number | null }): number {
  return variant.priceInPaise ?? itemPricePaise;
}

/** The OrderItem name snapshot for a variant line (rule 2). */
export function variantLineName(itemName: string, label: string): string {
  return `${itemName} – ${label}`;
}

/**
 * Cart key for one line: the item id, or "itemId:variantId" for a variant.
 * Ids are cuids, which never contain a colon.
 */
export function cartLineKey(menuItemId: string, variantId?: string | null): string {
  return variantId ? `${menuItemId}:${variantId}` : menuItemId;
}

export function parseCartLineKey(key: string): { menuItemId: string; variantId: string | null } {
  const i = key.indexOf(":");
  return i === -1 ? { menuItemId: key, variantId: null } : { menuItemId: key.slice(0, i), variantId: key.slice(i + 1) };
}

/** "from ₹X" when an item's variants don't all cost the same; null otherwise. */
export function variantPriceRange(
  itemPricePaise: number,
  variants: readonly { priceInPaise: number | null }[],
): { minPaise: number; maxPaise: number } | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => variantPricePaise(itemPricePaise, v));
  const minPaise = Math.min(...prices);
  const maxPaise = Math.max(...prices);
  return minPaise === maxPaise ? null : { minPaise, maxPaise };
}

/** One variant as the seller's /menu screen gets it (stock derived, lib/inventory.ts). */
export type VariantRow = {
  id: string;
  label: string;
  priceInPaise: number | null;
  isAvailable: boolean;
  sortOrder: number;
  stockQty: number | null;
  lowStockAt: number | null;
  stockLeft: number | null;
  stockSetAside: number | null;
};

/**
 * One size / colour as the public store page gets it: the price it sells for
 * and its buyer-facing stock (lib/storefront-stock.ts), never the count.
 */
export type StoreSize = {
  id: string;
  label: string;
  priceInPaise: number;
  /** "Sold out" / "Only N left" and the stepper's ceiling; null = not tracked. */
  stock: { soldOut: boolean; onlyLeft: number | null; maxQty: number | null } | null;
};

/** An item with sizes is sold out when none of them can be bought. */
export function allSizesSoldOut(sizes: readonly StoreSize[]): boolean {
  return sizes.every((s) => s.stock?.soldOut ?? false);
}
