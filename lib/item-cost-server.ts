/**
 * The database side of cost price (rules in lib/item-cost.ts). Server only.
 */

import type { Prisma } from "@prisma/client";

/**
 * Snapshot each line's unit cost onto a bill just created (lib/item-cost.ts
 * rule 4): the size's cost, else the item's, else it stays null. Call it
 * inside the transaction that created the bill, right after the create. One
 * statement whatever the bill's size; gift lines get their cost too, since a
 * gift leaves the shelf. Lines with no menu item (typed-in counter lines) and
 * another store's items are never touched.
 */
export async function stampOrderCosts(tx: Prisma.TransactionClient, vendorId: string, transactionId: string) {
  await tx.$executeRaw`
    UPDATE "order_items" AS oi
    SET "costInPaise" = COALESCE(
      (SELECT v."costInPaise" FROM "item_variants" v WHERE v."id" = oi."variantId" AND v."vendorId" = ${vendorId}),
      m."costInPaise"
    )
    FROM "menu_items" m
    WHERE oi."transactionId" = ${transactionId}
      AND m."id" = oi."menuItemId"
      AND m."vendorId" = ${vendorId}
      AND (m."costInPaise" IS NOT NULL OR oi."variantId" IS NOT NULL)
  `;
}
