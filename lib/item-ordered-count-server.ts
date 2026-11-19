import { stockTakingTxWhere } from "@/lib/inventory-server";
import { ORDERED_WINDOW_DAYS } from "@/lib/item-ordered-count";
import { prisma } from "@/lib/prisma";

/**
 * How many times each of `menuItemIds` was ordered in the last
 * `ORDERED_WINDOW_DAYS` days (rules in lib/item-ordered-count.ts): one
 * `groupBy` on `order_items` (indexed on `menuItemId`), scoped to the vendor
 * through the order. Items with no orders are absent. Read on the page render
 * only, never stored.
 */
export async function loadOrderedCounts(
  vendorId: string,
  menuItemIds: readonly string[],
  now: Date,
): Promise<Map<string, number>> {
  if (menuItemIds.length === 0) return new Map();
  const since = new Date(now.getTime() - ORDERED_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.orderItem.groupBy({
    by: ["menuItemId"],
    where: {
      menuItemId: { in: [...menuItemIds] },
      isGift: false,
      transaction: { AND: [stockTakingTxWhere(vendorId, now), { createdAt: { gte: since } }] },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) if (row.menuItemId) counts.set(row.menuItemId, row._count._all);
  return counts;
}
