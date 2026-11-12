/**
 * Menu rows with their derived stock left and units set aside for open orders
 * (lib/inventory.ts rule 2), for GET /api/menu and the /menu and /pos pages.
 * Server only. Two grouped queries whatever the menu size, and none at all
 * when nothing is tracked.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  stockLeftByMenuItem,
  stockLeftByVariant,
  stockSetAsideByMenuItem,
  stockSetAsideByVariant,
  type TrackedItem,
} from "@/lib/inventory-server";
import type { VariantRow } from "@/lib/item-variants";
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

/**
 * Menu rows with their sizes / colours (lib/item-variants.ts), each with its
 * own derived stock, for GET /api/menu and the /menu page. One query for the
 * variants, and the two stock queries only when one is tracked.
 */
export async function withVariants<T extends { id: string }>(
  db: Db,
  vendorId: string,
  items: T[],
  now: Date = new Date(),
): Promise<(T & { variants: VariantRow[] })[]> {
  if (items.length === 0) return [];
  const rows = await db.itemVariant.findMany({
    where: { vendorId, menuItemId: { in: items.map((i) => i.id) } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: VARIANT_ROW_SELECT,
  });
  const [left, setAside] = await Promise.all([
    stockLeftByVariant(db, vendorId, rows, now),
    stockSetAsideByVariant(db, vendorId, rows, now),
  ]);
  const byItem = new Map<string, VariantRow[]>();
  for (const { menuItemId, stockCountedAt: _counted, ...v } of rows) {
    const list = byItem.get(menuItemId) ?? [];
    list.push({ ...v, stockLeft: left.get(v.id) ?? null, stockSetAside: setAside.get(v.id) ?? null });
    byItem.set(menuItemId, list);
  }
  return items.map((item) => ({ ...item, variants: byItem.get(item.id) ?? [] }));
}

const VARIANT_ROW_SELECT = {
  id: true,
  menuItemId: true,
  label: true,
  priceInPaise: true,
  isAvailable: true,
  sortOrder: true,
  stockQty: true,
  stockCountedAt: true,
  lowStockAt: true,
} as const;
