/**
 * Inventory for everyday products (MenuItem). Pure and client-safe; the
 * database side is lib/inventory-server.ts. Read this before touching either.
 *
 * Rules:
 *
 *   1. Opt-in per item. `MenuItem.stockQty === null` means "not tracked": the
 *      item behaves exactly as before (only `isAvailable` matters). Kitchens
 *      never see stock unless they switch it on.
 *   2. Stock left is derived, never decremented. The seller records a count
 *      (`stockQty` at `stockCountedAt`); left = that count minus the units in
 *      stock-holding OrderItems created after it. Same idea as drops
 *      (lib/drops.ts rule 3), so a lapsed UPI hold, a cancel or a POS undo gives
 *      stock back with no extra write, and nothing runs on a timer.
 *   3. What holds stock: storefront orders that `stockHoldingOrderWhere` says
 *      hold (paid, pay on delivery, claimed, confirmed, or unpaid < 15 min), and
 *      every counter sale (source ≠ STOREFRONT). Gift lines count (they leave
 *      the shelf). Sample orders never count.
 *   4. Online orders can't oversell: `placeMenuOrder` and `placeStorefrontOrder`
 *      lock the tracked MenuItem rows (`FOR UPDATE`, id order) and refuse a line
 *      that needs more than is left (`out_of_stock`).
 *   5. The counter never refuses a sale over stock: the goods were handed over,
 *      and an offline sale can't be refused later anyway. Left may go negative;
 *      the seller sees "Oversold by N" and recounts.
 *   6. A drop item's own `maxQty` still applies; a tracked product in a drop is
 *      also capped by its stock left (the smaller wins).
 *   7. Buyers see "Sold out" at 0 and "Only N left" at or below the low-stock
 *      line (`lowStockAt`, else BUYER_HINT_DEFAULT). Never the exact count above it.
 */

/** "Only N left" shows to buyers from this many when the seller set no line. */
export const BUYER_HINT_DEFAULT = 3;

/** Largest count a seller can record for one item. */
export const MAX_STOCK_QTY = 100_000;

export type StockFields = {
  stockQty: number | null;
  lowStockAt: number | null;
};

/** Units left, or null when the item isn't tracked. May be negative (rule 5). */
export function stockLeft(stockQty: number | null, heldQty: number): number | null {
  if (stockQty === null) return null;
  return stockQty - heldQty;
}

export type StockState = "untracked" | "in_stock" | "low" | "sold_out" | "oversold";

/** Seller-facing state for a tracked item's `left`. */
export function stockState(left: number | null, lowStockAt: number | null): StockState {
  if (left === null) return "untracked";
  if (left < 0) return "oversold";
  if (left === 0) return "sold_out";
  if (lowStockAt !== null && left <= lowStockAt) return "low";
  return "in_stock";
}

/** Seller-facing label ("12 in stock", "Low: 2 left", "Sold out", "Oversold by 1"). */
export function stockLabel(left: number | null, lowStockAt: number | null): string | null {
  const state = stockState(left, lowStockAt);
  switch (state) {
    case "untracked":
      return null;
    case "oversold":
      return `Oversold by ${-(left as number)}`;
    case "sold_out":
      return "Sold out";
    case "low":
      return `Low: ${left} left`;
    case "in_stock":
      return `${left} in stock`;
  }
}

/**
 * What a buyer may see. `soldOut` hides the add button; `onlyLeft` is the
 * "Only N left" number, null when there is plenty (rule 7).
 */
export type BuyerStock = { soldOut: boolean; onlyLeft: number | null };

export function buyerStock(left: number | null, lowStockAt: number | null): BuyerStock {
  if (left === null) return { soldOut: false, onlyLeft: null };
  if (left <= 0) return { soldOut: true, onlyLeft: null };
  const line = lowStockAt ?? BUYER_HINT_DEFAULT;
  return { soldOut: false, onlyLeft: left <= line ? left : null };
}

/** The most a buyer can add of an item: null = no stock limit. */
export function buyerMaxQty(left: number | null): number | null {
  if (left === null) return null;
  return Math.max(0, left);
}

/** Smaller of a drop item's remaining cap and the product's stock left (rule 6). */
export function combinedRemaining(dropRemaining: number | null, left: number | null): number | null {
  const stock = left === null ? null : Math.max(0, left);
  if (dropRemaining === null) return stock;
  if (stock === null) return dropRemaining;
  return Math.min(dropRemaining, stock);
}

export type StockShortfall = { menuItemId: string; remaining: number };

/**
 * First line that needs more than is left, or null. `need` is menuItemId →
 * units this order takes (paid lines plus any gift); `left` comes from
 * `stockLeftByMenuItem`. Untracked items are absent from `left` and pass.
 */
export function firstShortfall(need: Map<string, number>, left: Map<string, number>): StockShortfall | null {
  for (const [menuItemId, qty] of need) {
    const l = left.get(menuItemId);
    if (l === undefined) continue;
    if (qty > l) return { menuItemId, remaining: Math.max(0, l) };
  }
  return null;
}

/** Validate a count a seller typed: whole number 0..MAX_STOCK_QTY, or null to stop tracking. */
export function isValidStockQty(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_STOCK_QTY;
}
