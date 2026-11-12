/**
 * Database side of inventory (rules in lib/inventory.ts). Server only.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { stockHoldingOrderWhere } from "@/lib/drops";
import { stockLeft } from "@/lib/inventory";

type Db = PrismaClient | Prisma.TransactionClient;

export type TrackedItem = { id: string; stockQty: number | null; stockCountedAt: Date | null };

/** Transactions whose lines take stock (lib/inventory.ts rule 3). */
function stockTakingTxWhere(vendorId: string, now: Date): Prisma.TransactionWhereInput {
  return {
    vendorId,
    isSample: false,
    OR: [{ source: { not: "STOREFRONT" } }, { AND: [{ source: "STOREFRONT" }, stockHoldingOrderWhere(now)] }],
  };
}

/**
 * Storefront orders placed by `countedAt` that still hold stock and were not
 * handed over by then (lib/inventory.ts rule 2b): their pieces were on the
 * shelf when the seller counted, so the count includes them, but they are
 * promised. A DELIVERED order without `deliveredAt` predates the stamp and is
 * treated as handed over long ago.
 */
function setAsideAtCountWhere(vendorId: string, now: Date, countedAt: Date): Prisma.TransactionWhereInput {
  return {
    vendorId,
    isSample: false,
    source: "STOREFRONT",
    createdAt: { lte: countedAt },
    AND: [
      stockHoldingOrderWhere(now),
      { OR: [{ fulfilmentStatus: { not: "DELIVERED" } }, { deliveredAt: { gt: countedAt } }] },
    ],
  };
}

/** What a stock count belongs to: a product, or one variant of it (lib/item-variants.ts rule 4). */
type StockKey = "menuItemId" | "variantId";

type HeldRow = Partial<Record<StockKey, string | null>> & { _sum: { qty: number | null } };

/** Units per `key` in the matching OrderItems. */
async function sumQtyBy(db: Db, key: StockKey, where: Prisma.OrderItemWhereInput): Promise<Map<string, number>> {
  // One grouped query; the cast is only because `by` is a union here.
  const rows = (await db.orderItem.groupBy({ by: [key], where, _sum: { qty: true } } as never)) as unknown as HeldRow[];
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = r[key];
    if (id) out.set(id, r._sum.qty ?? 0);
  }
  return out;
}

async function stockLeftBy(
  db: Db,
  vendorId: string,
  key: StockKey,
  items: TrackedItem[],
  now: Date,
): Promise<Map<string, number>> {
  const tracked = items.filter((i) => i.stockQty !== null);
  const out = new Map<string, number>();
  if (tracked.length === 0) return out;

  const txWhere = stockTakingTxWhere(vendorId, now);
  const held = await sumQtyBy(db, key, {
    OR: tracked.flatMap((i): Prisma.OrderItemWhereInput[] =>
      i.stockCountedAt
        ? [
            { [key]: i.id, transaction: { AND: [txWhere, { createdAt: { gt: i.stockCountedAt } }] } },
            { [key]: i.id, transaction: setAsideAtCountWhere(vendorId, now, i.stockCountedAt) },
          ]
        : [{ [key]: i.id, transaction: txWhere }],
    ),
  });
  for (const i of tracked) out.set(i.id, stockLeft(i.stockQty, held.get(i.id) ?? 0) as number);
  return out;
}

async function stockSetAsideBy(
  db: Db,
  vendorId: string,
  key: StockKey,
  items: TrackedItem[],
  now: Date,
): Promise<Map<string, number>> {
  const ids = items.filter((i) => i.stockQty !== null).map((i) => i.id);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const held = await sumQtyBy(db, key, {
    [key]: { in: ids },
    transaction: {
      vendorId,
      isSample: false,
      source: "STOREFRONT",
      AND: [stockHoldingOrderWhere(now), { fulfilmentStatus: { not: "DELIVERED" } }],
    },
  });
  for (const id of ids) out.set(id, held.get(id) ?? 0);
  return out;
}

/**
 * menuItemId → units left, for the tracked items among `items` only
 * (untracked ids are absent). One grouped query, whatever the count.
 */
export function stockLeftByMenuItem(
  db: Db,
  vendorId: string,
  items: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  return stockLeftBy(db, vendorId, "menuItemId", items, now);
}

/** variantId → units left, for the tracked variants among `variants` (lib/item-variants.ts rule 4). */
export function stockLeftByVariant(
  db: Db,
  vendorId: string,
  variants: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  return stockLeftBy(db, vendorId, "variantId", variants, now);
}

/**
 * menuItemId → units set aside right now: storefront orders that hold stock and
 * are not handed over yet, so their pieces are still on the shelf (rule 2b).
 * On shelf = left + set aside; "Set count" starts from that, so saving the
 * same shelf twice changes nothing. Tracked items only (others are absent).
 */
export function stockSetAsideByMenuItem(
  db: Db,
  vendorId: string,
  items: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  return stockSetAsideBy(db, vendorId, "menuItemId", items, now);
}

/** variantId → units set aside right now (as `stockSetAsideByMenuItem`). */
export function stockSetAsideByVariant(
  db: Db,
  vendorId: string,
  variants: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  return stockSetAsideBy(db, vendorId, "variantId", variants, now);
}

/**
 * Lock this vendor's tracked MenuItem rows among `ids` (rule 4), in id order so
 * two orders never deadlock, and return their stock fields. Call inside the
 * order's `$transaction` before reading stock left.
 */
export async function lockTrackedMenuItems(
  tx: Prisma.TransactionClient,
  vendorId: string,
  ids: string[],
): Promise<TrackedItem[]> {
  const unique = Array.from(new Set(ids)).sort();
  if (unique.length === 0) return [];
  return tx.$queryRaw<TrackedItem[]>`
    SELECT id, "stockQty", "stockCountedAt" FROM menu_items
    WHERE "vendorId" = ${vendorId} AND id IN (${Prisma.join(unique)}) AND "stockQty" IS NOT NULL
    ORDER BY id FOR UPDATE`;
}

/** Record a new count: sets `stockQty` and moves `stockCountedAt` to now. Compound scope. */
export async function recordStockCount(
  db: Db,
  vendorId: string,
  menuItemId: string,
  stockQty: number | null,
  now: Date = new Date(),
) {
  return db.menuItem.updateMany({
    where: { id: menuItemId, vendorId },
    data: { stockQty, stockCountedAt: stockQty === null ? null : now },
  });
}

/**
 * Move a tracked item's count by `delta` ("+5 received", "−1 damaged") without
 * moving `stockCountedAt` (rule 2a), so orders taken since the count keep
 * counting and a lapsed hold or a cancel still gives its stock back. Compound
 * scope; only tracked rows change.
 */
export async function recordStockAdjust(db: Db, vendorId: string, menuItemId: string, delta: number) {
  return db.menuItem.updateMany({
    where: { id: menuItemId, vendorId, stockQty: { not: null } },
    data: { stockQty: { increment: delta } },
  });
}

/**
 * Lock this vendor's tracked variant rows among `ids`, in id order, and return
 * their stock fields (lib/item-variants.ts rule 4). Take item locks first, then
 * these, so two orders always lock in the same order.
 */
export async function lockTrackedVariants(
  tx: Prisma.TransactionClient,
  vendorId: string,
  ids: string[],
): Promise<TrackedItem[]> {
  const unique = Array.from(new Set(ids)).sort();
  if (unique.length === 0) return [];
  return tx.$queryRaw<TrackedItem[]>`
    SELECT id, "stockQty", "stockCountedAt" FROM item_variants
    WHERE "vendorId" = ${vendorId} AND id IN (${Prisma.join(unique)}) AND "stockQty" IS NOT NULL
    ORDER BY id FOR UPDATE`;
}

/** `recordStockCount` for one variant. Compound scope (vendor and item). */
export async function recordVariantStockCount(
  db: Db,
  vendorId: string,
  menuItemId: string,
  variantId: string,
  stockQty: number | null,
  now: Date = new Date(),
) {
  return db.itemVariant.updateMany({
    where: { id: variantId, menuItemId, vendorId },
    data: { stockQty, stockCountedAt: stockQty === null ? null : now },
  });
}

/** `recordStockAdjust` for one variant (rule 2a): the count moves, its time doesn't. */
export async function recordVariantStockAdjust(
  db: Db,
  vendorId: string,
  menuItemId: string,
  variantId: string,
  delta: number,
) {
  return db.itemVariant.updateMany({
    where: { id: variantId, menuItemId, vendorId, stockQty: { not: null } },
    data: { stockQty: { increment: delta } },
  });
}
