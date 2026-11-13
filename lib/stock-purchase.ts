/**
 * Stock purchases: a dated record of pieces that came in and what each cost.
 * Pure, client-safe and zod-free (the wire schema is
 * lib/stock-purchase-schema.ts); the database side is
 * lib/stock-purchase-server.ts. Plan in docs/COST_AND_PROFIT_PLAN.md (step 2).
 *
 * Rules:
 *
 *   1. A record, not a second stock counter. "Received" moves the count the
 *      way +n does (`recordStockAdjust`: `stockCountedAt` stays put,
 *      lib/inventory.ts rule 2a) and writes one `StockPurchase` row per size in
 *      the same transaction. Stock left never comes from summing purchases.
 *   2. MANAGER and OWNER only, like cost (lib/item-cost.ts rule 2). A cashier
 *      keeps −1 / +1 and "Set count", which write no purchase.
 *   3. Only tracked stock can be received. Switching tracking on, or a count,
 *      is opening stock: no purchase row.
 *   4. A cost given with a purchase becomes the latest cost (lib/item-cost.ts
 *      rule 3): a size that has its own cost gets it, otherwise the item does.
 *      Left blank, the purchase keeps the cost on record at that moment, which
 *      may be none.
 *   5. An item with sizes is received by size; one without takes one line.
 *   6. A purchase cannot be edited or undone yet: take the extra pieces off
 *      with −1 and correct the cost in the item form.
 */

import { formatINR } from "@/lib/currency";
import { formatIstDate } from "@/lib/datetime";

/** One delivery covers at most this many sizes. */
export const MAX_PURCHASE_LINES = 50;

/** How many past purchases the item form lists. */
export const RECENT_PURCHASES = 5;

/** One purchase as the item form gets it. */
export type PurchaseRow = {
  id: string;
  /** The size or colour, when the item has them. */
  variantLabel: string | null;
  qty: number;
  /** null = no cost was recorded for it. */
  unitCostInPaise: number | null;
  /** ISO time. */
  purchasedAt: string;
};

/** What the pieces of one delivery cost together, or null when the cost is not known. */
export function purchaseTotalPaise(qty: number, unitCostPaise: number | null): number | null {
  return unitCostPaise === null ? null : qty * unitCostPaise;
}

/** "12/11/2026 · M · 10 received · ₹450.00 each" for the item form's list. */
export function purchaseLine(row: PurchaseRow): string {
  return [
    formatIstDate(new Date(row.purchasedAt)),
    row.variantLabel,
    `${row.qty} received`,
    row.unitCostInPaise === null ? "cost not recorded" : `${formatINR(row.unitCostInPaise)} each`,
  ]
    .filter(Boolean)
    .join(" · ");
}
