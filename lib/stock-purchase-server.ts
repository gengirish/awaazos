/** Database side of stock purchases. Rules in lib/stock-purchase.ts. */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  lockTrackedMenuItems,
  lockTrackedVariants,
  recordStockAdjust,
  recordVariantStockAdjust,
  stockLeftByMenuItem,
  stockLeftByVariant,
} from "@/lib/inventory-server";
import { unitCostFor } from "@/lib/item-cost";
import { adjustDelta } from "@/lib/menu-stock";
import { RECENT_PURCHASES, type PurchaseRow } from "@/lib/stock-purchase";

type Db = PrismaClient | Prisma.TransactionClient;

/** Thrown by `receiveStock`; the route maps it to its status. */
export class ReceiveStockError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const PURCHASE_SELECT = {
  id: true,
  variantLabel: true,
  qty: true,
  unitCostInPaise: true,
  purchasedAt: true,
} as const;

type PurchaseRecord = Prisma.StockPurchaseGetPayload<{ select: typeof PURCHASE_SELECT }>;

function toRow(p: PurchaseRecord): PurchaseRow {
  return { ...p, purchasedAt: p.purchasedAt.toISOString() };
}

export type ReceiveStockInput = {
  vendorId: string;
  menuItemId: string;
  lines: { variantId?: string; qty: number }[];
  /** Paise each; undefined = keep the cost on record (rule 4). */
  costInPaise?: number;
  userId?: string | null;
  now?: Date;
};

/**
 * Record stock that came in (rules 1, 3, 4, 5). Call inside a `$transaction`.
 * Every read and write is scoped to `vendorId`; an item or size of another
 * store is "Not found".
 */
export async function receiveStock(tx: Prisma.TransactionClient, input: ReceiveStockInput) {
  const { vendorId, menuItemId, lines, costInPaise } = input;
  const now = input.now ?? new Date();

  const item = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId },
    select: { id: true, costInPaise: true, variants: { select: { id: true, label: true, costInPaise: true } } },
  });
  if (!item) throw new ReceiveStockError(404, "Not found");

  const sizes = new Map(item.variants.map((v) => [v.id, v]));
  if (sizes.size > 0) {
    if (lines.some((l) => !l.variantId)) throw new ReceiveStockError(400, "size_required");
    if (lines.some((l) => !sizes.has(l.variantId!))) throw new ReceiveStockError(404, "Not found");
  } else if (lines.length !== 1 || lines[0].variantId) {
    throw new ReceiveStockError(404, "Not found");
  }

  // Locked like an order taking the same stock (lib/inventory.ts rule 4), so
  // "left" can't move between the read and the change.
  if (sizes.size === 0) {
    const [locked] = await lockTrackedMenuItems(tx, vendorId, [item.id]);
    if (!locked) throw new ReceiveStockError(409, "stock_not_tracked");
    const left = (await stockLeftByMenuItem(tx, vendorId, [locked])).get(item.id) ?? 0;
    const delta = adjustDelta(left, lines[0].qty);
    if (delta !== 0) await recordStockAdjust(tx, vendorId, item.id, delta);
  } else {
    const ids = lines.map((l) => l.variantId!);
    const locked = await lockTrackedVariants(tx, vendorId, ids);
    if (locked.length !== ids.length) throw new ReceiveStockError(409, "stock_not_tracked");
    const left = await stockLeftByVariant(tx, vendorId, locked);
    for (const line of lines) {
      const delta = adjustDelta(left.get(line.variantId!) ?? 0, line.qty);
      if (delta !== 0) await recordVariantStockAdjust(tx, vendorId, item.id, line.variantId!, delta);
    }
  }

  const purchases: PurchaseRecord[] = [];
  for (const line of lines) {
    const size = line.variantId ? sizes.get(line.variantId)! : null;
    purchases.push(
      await tx.stockPurchase.create({
        data: {
          vendorId,
          menuItemId: item.id,
          variantId: size?.id ?? null,
          variantLabel: size?.label ?? null,
          qty: line.qty,
          unitCostInPaise: costInPaise ?? unitCostFor(item.costInPaise, size?.costInPaise),
          purchasedAt: now,
          createdByUserId: input.userId ?? null,
        },
        select: PURCHASE_SELECT,
      }),
    );
  }

  // The latest cost (rule 4): a size with its own cost takes it, else the item.
  let itemCost = item.costInPaise;
  if (costInPaise !== undefined) {
    const own = lines
      .filter((l) => l.variantId && sizes.get(l.variantId)!.costInPaise !== null)
      .map((l) => l.variantId!);
    if (own.length > 0) {
      await tx.itemVariant.updateMany({
        where: { id: { in: own }, menuItemId: item.id, vendorId },
        data: { costInPaise },
      });
    }
    if (own.length < lines.length) {
      await tx.menuItem.updateMany({ where: { id: item.id, vendorId }, data: { costInPaise } });
      itemCost = costInPaise;
    }
  }

  return { purchases: purchases.map(toRow), costInPaise: itemCost };
}

/** The item's latest purchases, newest first. Scoped to the vendor. */
export async function recentPurchases(db: Db, vendorId: string, menuItemId: string): Promise<PurchaseRow[]> {
  const rows = await db.stockPurchase.findMany({
    where: { vendorId, menuItemId },
    orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
    take: RECENT_PURCHASES,
    select: PURCHASE_SELECT,
  });
  return rows.map(toRow);
}
