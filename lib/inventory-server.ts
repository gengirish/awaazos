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

/**
 * menuItemId → units left, for the tracked items among `items` only
 * (untracked ids are absent). One grouped query, whatever the count.
 */
export async function stockLeftByMenuItem(
  db: Db,
  vendorId: string,
  items: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const tracked = items.filter((i) => i.stockQty !== null);
  const out = new Map<string, number>();
  if (tracked.length === 0) return out;

  const txWhere = stockTakingTxWhere(vendorId, now);
  const rows = await db.orderItem.groupBy({
    by: ["menuItemId"],
    where: {
      OR: tracked.flatMap((i): Prisma.OrderItemWhereInput[] =>
        i.stockCountedAt
          ? [
              { menuItemId: i.id, transaction: { AND: [txWhere, { createdAt: { gt: i.stockCountedAt } }] } },
              { menuItemId: i.id, transaction: setAsideAtCountWhere(vendorId, now, i.stockCountedAt) },
            ]
          : [{ menuItemId: i.id, transaction: txWhere }],
      ),
    },
    _sum: { qty: true },
  });
  const held = new Map<string, number>();
  for (const r of rows) if (r.menuItemId) held.set(r.menuItemId, r._sum.qty ?? 0);
  for (const i of tracked) out.set(i.id, stockLeft(i.stockQty, held.get(i.id) ?? 0) as number);
  return out;
}

/**
 * menuItemId → units set aside right now: storefront orders that hold stock and
 * are not handed over yet, so their pieces are still on the shelf (rule 2b).
 * On shelf = left + set aside; "Set count" starts from that, so saving the
 * same shelf twice changes nothing. Tracked items only (others are absent).
 */
export async function stockSetAsideByMenuItem(
  db: Db,
  vendorId: string,
  items: TrackedItem[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const ids = items.filter((i) => i.stockQty !== null).map((i) => i.id);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.orderItem.groupBy({
    by: ["menuItemId"],
    where: {
      menuItemId: { in: ids },
      transaction: {
        vendorId,
        isSample: false,
        source: "STOREFRONT",
        AND: [stockHoldingOrderWhere(now), { fulfilmentStatus: { not: "DELIVERED" } }],
      },
    },
    _sum: { qty: true },
  });
  for (const id of ids) out.set(id, 0);
  for (const r of rows) if (r.menuItemId) out.set(r.menuItemId, r._sum.qty ?? 0);
  return out;
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
