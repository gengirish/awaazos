import { buyerMaxQty, buyerStock, combinedRemaining } from "@/lib/inventory";

/**
 * Product stock as the public store page shows it (rules in lib/inventory.ts,
 * rule 7). Pure and client-safe. The page loader works out `left` with
 * `stockLeftByMenuItem`; only what is below reaches the browser: never
 * `stockCountedAt`, and never a count above the low-stock line except as the
 * stepper's ceiling.
 */

/** One everyday item's stock for the buyer. */
export type StorefrontStock = {
  soldOut: boolean;
  /** "Only N left"; null when there is plenty. */
  onlyLeft: number | null;
  /** The most the buyer can add; null = no stock limit. */
  maxQty: number | null;
};

/** Null for an untracked item (`left` null): the page then shows it exactly as before. */
export function storefrontStock(left: number | null, lowStockAt: number | null): StorefrontStock | null {
  if (left === null) return null;
  return { ...buyerStock(left, lowStockAt), maxQty: buyerMaxQty(left) };
}

/**
 * A drop item: `remaining` is the smaller of the drop's cap and the product's
 * stock (rule 6). `onlyLeft` is set (number or null) only when product stock
 * is what binds, so the badge follows the store's low-stock line instead of
 * printing the stock count; undefined keeps the drop's own badge.
 */
export function dropItemStock(
  dropRemaining: number | null,
  left: number | null,
  lowStockAt: number | null,
): { remaining: number | null; onlyLeft?: number | null } {
  const remaining = combinedRemaining(dropRemaining, left);
  if (left === null) return { remaining };
  const stock = Math.max(0, left);
  if (dropRemaining !== null && dropRemaining <= stock) return { remaining };
  return { remaining, onlyLeft: buyerStock(left, lowStockAt).onlyLeft };
}

/** Badge text for an item: "Sold out", "Only N left", or null. */
export function stockBadgeText(stock: Pick<StorefrontStock, "soldOut" | "onlyLeft"> | null): string | null {
  if (!stock) return null;
  if (stock.soldOut) return "Sold out";
  return stock.onlyLeft !== null ? `Only ${stock.onlyLeft} left` : null;
}

/**
 * Stock learned from an `out_of_stock` / `sold_out` rejection on top of what
 * the page said: the server's `remaining` wins until refreshed props land.
 */
export function withStockOverride(stock: StorefrontStock | null, override: number | undefined): StorefrontStock | null {
  if (override === undefined) return stock;
  const left = stock?.maxQty == null ? override : Math.min(override, stock.maxQty);
  const max = Math.max(0, left);
  return { soldOut: max <= 0, onlyLeft: max > 0 ? max : null, maxQty: max };
}

/** Cart after a stock rejection for `id`: removed at 0, else cut down to what is left. */
export function cartAfterStockRejection(
  cart: Readonly<Record<string, number>>,
  id: string,
  remaining: number,
): Record<string, number> {
  const left = Math.max(0, remaining);
  const next = { ...cart };
  if (left <= 0) delete next[id];
  else if ((next[id] ?? 0) > left) next[id] = left;
  return next;
}
