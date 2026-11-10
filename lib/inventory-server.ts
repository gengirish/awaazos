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
      OR: tracked.map((i) => ({
        menuItemId: i.id,
        transaction: {
          AND: [txWhere, i.stockCountedAt ? { createdAt: { gt: i.stockCountedAt } } : {}],
        },
      })),
    },
    _sum: { qty: true },
  });
  const held = new Map<string, number>();
  for (const r of rows) if (r.menuItemId) held.set(r.menuItemId, r._sum.qty ?? 0);
  for (const i of tracked) out.set(i.id, stockLeft(i.stockQty, held.get(i.id) ?? 0) as number);
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
