/**
 * Menu rows with their derived stock left and units set aside for open orders
 * (lib/inventory.ts rule 2), for GET /api/menu and the /menu and /pos pages.
 * Server only. Two grouped queries whatever the menu size, and none at all
 * when nothing is tracked.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { stockLeftByMenuItem, stockSetAsideByMenuItem, type TrackedItem } from "@/lib/inventory-server";
import type { WithStockLeft } from "@/lib/menu-stock";

type Db = PrismaClient | Prisma.TransactionClient;

export async function withStockLeft<T extends TrackedItem>(
  db: Db,
  vendorId: string,
  items: T[],
  now: Date = new Date(),
): Promise<(T & WithStockLeft)[]> {
  const [left, setAside] = await Promise.all([
    stockLeftByMenuItem(db, vendorId, items, now),
    stockSetAsideByMenuItem(db, vendorId, items, now),
  ]);
  return items.map((item) => ({
    ...item,
    stockLeft: left.get(item.id) ?? null,
    stockSetAside: setAside.get(item.id) ?? null,
  }));
}
