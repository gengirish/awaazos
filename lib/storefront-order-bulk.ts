/**
 * Server side of bulk order actions — `POST /api/drops/[id]/orders/bulk` and
 * `POST /api/storefront-orders/bulk`. Eligibility and the request schema are
 * client-safe and live in lib/order-bulk.ts.
 *
 * One transaction PER ORDER, run one after another, not one transaction for
 * the batch:
 *   - an order that changed on another phone (invalid_state) must not roll
 *     back the nine that were fine;
 *   - each order goes through exactly the same `applyStorefrontOrderAction`
 *     the single-order route uses — same compound scope
 *     `{ id, vendorId, source: "STOREFRONT", dropId }`, same conditional
 *     writes, same markOrderPaid (idempotent DailySummary credit);
 *   - sequential keeps it to one pooled connection and avoids every order
 *     contending on the same DailySummary row at once.
 *
 * Drop orders re-read the drop (compound `{ id, vendorId }`) inside each
 * transaction, as the single route does, so a freeze mid-batch is honoured.
 * Unknown and cross-tenant ids both come back as `not_found` — the response
 * never says whether an id exists elsewhere.
 */

import type { DropStatus, Prisma } from "@prisma/client";

import type { BoardOrderRow } from "@/lib/drops-board-server";
import type { BulkFailureCode, BulkOrderAction, BulkOrderResult } from "@/lib/order-bulk";
import {
  OrderActionError,
  applyStorefrontOrderAction,
  storefrontOrderScope,
  type OrderActionErrorCode,
} from "@/lib/storefront-order-actions";

/** `prisma.$transaction` (interactive form), injectable for tests. */
export type RunInTransaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

const FAILURE_CODE: Record<OrderActionErrorCode, BulkFailureCode> = {
  "Not found": "not_found",
  drop_frozen: "drop_frozen",
  invalid_state: "invalid_state",
};

export async function runBulkStorefrontOrderAction(args: {
  runInTransaction: RunInTransaction;
  vendorId: string;
  /** The drop every order must belong to, or null for "order from menu" orders. */
  dropId: string | null;
  orderIds: string[];
  action: BulkOrderAction;
  now?: Date;
}): Promise<BulkOrderResult & { updated: BoardOrderRow[] }> {
  const { runInTransaction, vendorId, dropId, action, now } = args;
  const succeeded: string[] = [];
  const failed: BulkOrderResult["failed"] = [];
  const updated: BoardOrderRow[] = [];

  for (const orderId of args.orderIds) {
    const scope = storefrontOrderScope({ orderId, vendorId, dropId });
    try {
      const row = await runInTransaction(async (tx) => {
        let dropStatus: DropStatus | null = null;
        if (dropId !== null) {
          const drop = await tx.drop.findFirst({ where: { id: dropId, vendorId }, select: { status: true } });
          if (!drop) throw new OrderActionError(404, "Not found");
          dropStatus = drop.status;
        }
        return applyStorefrontOrderAction(tx, { scope, action, dropStatus, now });
      });
      succeeded.push(orderId);
      updated.push(row);
    } catch (err) {
      if (err instanceof OrderActionError) {
        failed.push({ id: orderId, error: FAILURE_CODE[err.code] });
        continue;
      }
      // Unexpected (DB hiccup). Keep going; the vendor sees it as "not changed".
      // Ids and codes only — never the order's customer fields.
      console.error(
        JSON.stringify({
          event: "bulk_order_action_failed",
          vendorId,
          action,
          error: err instanceof Error ? err.name : "unknown",
        }),
      );
      failed.push({ id: orderId, error: "error" });
    }
  }

  return { succeeded, failed, updated };
}
