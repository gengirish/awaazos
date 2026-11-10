/**
 * Menu rows with their derived stock left (lib/inventory.ts rule 2), for
 * GET /api/menu and the /menu page. Server only. One grouped query whatever
 * the menu size, and none at all when nothing is tracked.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { stockLeftByMenuItem, type TrackedItem } from "@/lib/inventory-server";
import type { WithStockLeft } from "@/lib/menu-stock";

type Db = PrismaClient | Prisma.TransactionClient;

export async function withStockLeft<T extends TrackedItem>(
  db: Db,
  vendorId: string,
  items: T[],
  now: Date = new Date(),
): Promise<(T & WithStockLeft)[]> {
  const left = await stockLeftByMenuItem(db, vendorId, items, now);
  return items.map((item) => ({ ...item, stockLeft: left.get(item.id) ?? null }));
}
