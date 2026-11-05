/**
 * Vendor actions on a storefront order — shared by the drop orders board
 * (`/api/drops/[id]/orders/[orderId]`) and the "order from menu" board
 * (`/api/storefront-orders/[orderId]`).
 *
 *   confirm    PLACED → CONFIRMED
 *   mark_paid  markOrderPaid (credits DailySummary once; PLACED → CONFIRMED) — "Payment received"
 *   reject_payment  "Not received": clears the buyer's "I've paid" claim (and any
 *              UTR), stamps paymentRejectedAt. mark_paid, reject_payment and cancel
 *              also drop the buyer's payment screenshot (lib/payment-proof.ts). The order stops holding stock once
 *              its 15-minute window has passed; a new claim then needs a UTR.
 *   cancel     cancelOrder (reverses revenue if it was paid; vendor refunds via UPI)
 *   dispatch   a DELIVERY order handed to a rider: PLACED|CONFIRMED → CONFIRMED,
 *              stamps outForDeliveryAt (+ riderName). Sending it again restamps.
 *   deliver    PLACED|CONFIRMED → DELIVERED; unpaid CASH is marked paid in the same txn
 *   undeliver  DELIVERED → CONFIRMED (mistake fix; payment untouched)
 *   refund_payment_issue  Razorpay accepted a refund of the flagged payment: clears the
 *              issue. Fulfilment and DailySummary are untouched (that payment was never credited).
 *   keep_payment_issue    the seller keeps the order or sorts it out in Razorpay: clears the issue.
 *
 * Money leaving through Razorpay happens before this, in lib/storefront-order-refund.ts.
 *
 * Every read and write is pinned to a compound scope
 * `{ id, vendorId, source: "STOREFRONT", dropId }` — `dropId: null` for a menu
 * order — so a forged id from another tenant, another drop, or a counter sale
 * never matches (the caller turns that into a 404). Money moves only through
 * markOrderPaid / cancelOrder in lib/drops.ts, which keep DailySummary right.
 *
 * The pure pre-flight (`checkOrderAction`, incl. the frozen-drop rule) lives in
 * lib/drops-board.ts so the client can import it; it is re-exported here.
 */

import type { DropStatus, Prisma } from "@prisma/client";

import { cancelOrder, generateOrderToken, markOrderPaid } from "@/lib/drops";
import { checkOrderAction, type OrderAction } from "@/lib/drops-board";
import { boardOrderSelect, type BoardOrderRow } from "@/lib/drops-board-server";
import { parsePaymentIssue, type RefundFailure } from "@/lib/payment-issue";
import { deletePaymentProofInBackground } from "@/lib/payment-proof";

export { ORDER_ACTIONS, checkOrderAction, type OrderAction } from "@/lib/drops-board";

export type StorefrontOrderScope = {
  id: string;
  vendorId: string;
  source: "STOREFRONT";
  /** The drop this order must belong to, or null for an "order from menu" order. */
  dropId: string | null;
};

export type OrderActionErrorCode =
  | "Not found"
  | "drop_frozen"
  | "invalid_state"
  | "manager_required"
  | "refund_failed";

/** Thrown inside the transaction so it rolls back; routes map it to `{ error: code }`. */
export class OrderActionError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    public readonly code: OrderActionErrorCode,
    /** refund_failed only: why Razorpay didn't take it (lib/payment-issue.ts). */
    public readonly reason?: RefundFailure,
  ) {
    super(code);
    this.name = "OrderActionError";
  }
}

export function storefrontOrderScope(args: {
  orderId: string;
  vendorId: string;
  dropId: string | null;
}): StorefrontOrderScope {
  return { id: args.orderId, vendorId: args.vendorId, source: "STOREFRONT", dropId: args.dropId };
}

/**
 * Apply one vendor action inside `tx` (the caller owns the `prisma.$transaction`).
 *
 * `dropStatus` is the stored status of the order's drop (the caller has already
 * loaded the drop with a compound vendorId filter and 404'd if missing), or
 * null for a menu order. Returns the updated row in board shape; throws
 * OrderActionError (404 not in scope, 409 drop_frozen / invalid_state).
 *
 * The pre-flight gives a clean 409 for obvious cases; the conditional
 * `updateMany` writes are what stop two phones double-applying.
 */
export async function applyStorefrontOrderAction(
  tx: Prisma.TransactionClient,
  args: {
    scope: StorefrontOrderScope;
    action: OrderAction;
    dropStatus: DropStatus | null;
    /** dispatch only: the saved rider it went with ("Send to Ramesh"); omitted = unnamed. */
    riderName?: string | null;
    /** A refund Razorpay already accepted for this action (lib/storefront-order-refund.ts). */
    razorpayRefundId?: string;
    /** cancel only: the seller chose "Cancel anyway, I'll refund from Razorpay". */
    manualRefund?: boolean;
    now?: Date;
  },
): Promise<BoardOrderRow> {
  const { scope, action, dropStatus } = args;
  const { vendorId, id: transactionId } = scope;

  const order = await tx.transaction.findFirst({
    where: scope,
    select: {
      fulfilmentStatus: true,
      paymentStatus: true,
      paymentMethod: true,
      fulfilmentType: true,
      riderToken: true,
      paymentProofUrl: true,
      razorpayPaymentId: true,
      paymentIssue: true,
    },
  });
  if (!order) throw new OrderActionError(404, "Not found");

  const paymentIssue = parsePaymentIssue(order.paymentIssue);
  const check = checkOrderAction(action, dropStatus, { ...order, paymentIssue });
  if (!check.ok) throw new OrderActionError(409, check.error);

  let applied = false;
  switch (action) {
    case "confirm": {
      const r = await tx.transaction.updateMany({
        where: { ...scope, fulfilmentStatus: "PLACED" },
        data: { fulfilmentStatus: "CONFIRMED" },
      });
      applied = r.count === 1;
      break;
    }
    case "mark_paid": {
      // Order already verified in this txn against the full compound scope.
      applied = await markOrderPaid(tx, { vendorId, transactionId, now: args.now });
      break;
    }
    case "reject_payment": {
      const r = await tx.transaction.updateMany({
        where: {
          ...scope,
          paymentStatus: "PENDING",
          fulfilmentStatus: { not: "CANCELLED" },
          OR: [{ paymentClaimedAt: { not: null } }, { upiRef: { not: null } }],
        },
        data: { paymentClaimedAt: null, upiRef: null, paymentRejectedAt: args.now ?? new Date() },
      });
      applied = r.count === 1;
      break;
    }
    case "cancel": {
      // The buyer's Razorpay payment landed after the refund step looked: the order
      // must not read "refunded" with the money still in Razorpay. The next tap refunds.
      if (order.paymentStatus === "PAID" && order.razorpayPaymentId && !args.razorpayRefundId && !args.manualRefund) {
        throw new OrderActionError(409, "invalid_state");
      }
      applied = await cancelOrder(tx, { vendorId, transactionId, razorpayRefundId: args.razorpayRefundId, now: args.now });
      // Cancelling is the answer to a late payment. A second payment still needs its own.
      if (applied && paymentIssue === "paid_late_oversold") {
        await tx.transaction.updateMany({ where: scope, data: { paymentIssue: null, paymentIssueAt: null } });
      }
      break;
    }
    case "dispatch": {
      const r = await tx.transaction.updateMany({
        where: { ...scope, fulfilmentType: "DELIVERY", fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } },
        data: {
          fulfilmentStatus: "CONFIRMED",
          outForDeliveryAt: args.now ?? new Date(),
          riderName: args.riderName?.trim() || null,
        },
      });
      applied = r.count === 1;
      break;
    }
    case "deliver": {
      const r = await tx.transaction.updateMany({
        where: { ...scope, fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } },
        data: { fulfilmentStatus: "DELIVERED" },
      });
      applied = r.count === 1;
      if (applied && order.paymentMethod === "CASH" && order.paymentStatus !== "PAID") {
        // Pay-on-delivery collected at the door. A false here means a
        // concurrent tap already marked it paid — fine either way.
        await markOrderPaid(tx, { vendorId, transactionId, now: args.now });
      }
      break;
    }
    case "undeliver": {
      const r = await tx.transaction.updateMany({
        where: { ...scope, fulfilmentStatus: "DELIVERED" },
        data: { fulfilmentStatus: "CONFIRMED" },
      });
      applied = r.count === 1;
      break;
    }
    case "refund_payment_issue": {
      if (!args.razorpayRefundId) throw new OrderActionError(409, "invalid_state");
      const r = await tx.transaction.updateMany({
        where: { ...scope, paymentIssue: { in: ["paid_after_cancel", "paid_twice"] } },
        data: { paymentIssue: null, paymentIssueAt: null, razorpayRefundId: args.razorpayRefundId },
      });
      applied = r.count === 1;
      break;
    }
    case "keep_payment_issue": {
      const r = await tx.transaction.updateMany({
        where: { ...scope, paymentIssue: { not: null } },
        data: { paymentIssue: null, paymentIssueAt: null },
      });
      applied = r.count === 1;
      break;
    }
  }
  if (!applied) throw new OrderActionError(409, "invalid_state");

  // A delivery placed before rider links existed gets one when it is confirmed
  // (incl. by being paid) or sent out. `riderToken: null` in the where keeps the first one minted.
  const confirms = action === "confirm" || action === "mark_paid" || action === "dispatch";
  if (confirms && order.fulfilmentType === "DELIVERY" && !order.riderToken) {
    await tx.transaction.updateMany({ where: { ...scope, riderToken: null }, data: { riderToken: generateOrderToken() } });
  }

  // The seller has answered the buyer's claim (or dropped the order): the
  // payment screenshot has done its job and is PII, so it goes (lib/payment-proof.ts).
  const answersClaim = action === "mark_paid" || action === "reject_payment" || action === "cancel";
  if (answersClaim && order.paymentProofUrl) {
    await tx.transaction.updateMany({ where: { ...scope, paymentProofUrl: { not: null } }, data: { paymentProofUrl: null } });
    deletePaymentProofInBackground(order.paymentProofUrl);
  }

  return tx.transaction.findFirstOrThrow({ where: scope, select: boardOrderSelect });
}
