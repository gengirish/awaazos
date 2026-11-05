/**
 * The part of a board action that moves real money, run BEFORE the action's
 * database transaction: a Razorpay call has no place inside one.
 *
 *   cancel                a paid order with a Razorpay payment: refund, then cancel
 *   refund_payment_issue  refund the flagged payment; the order itself is untouched
 *   keep_payment_issue    no money moves, but the same people decide it
 *
 * All of it needs MANAGER, though a plain cancel is CASHIER. The order is read with
 * the action's compound scope, so another tenant's id is a 404 before the role check.
 *
 * A refund Razorpay accepted but we failed to record (a crash, a lost connection)
 * is safe to retry: `refundPaymentViaRazorpay` finds it and never pays twice. Two
 * phones racing end the same way: one refund, and one 409 from the conditional write.
 */

import { checkOrderAction, type OrderAction } from "@/lib/drops-board";
import { issueOffersRefund, parsePaymentIssue } from "@/lib/payment-issue";
import { prisma } from "@/lib/prisma";
import { OrderActionError, type StorefrontOrderScope } from "@/lib/storefront-order-actions";
import { getVendorRazorpayCreds, RazorpayRefundError, refundPaymentViaRazorpay } from "@/lib/storefront-razorpay";

/** "manual" is the seller's "Cancel anyway, I'll refund from Razorpay". */
export type RefundMode = "razorpay" | "manual";

export type PreparedMoney = { razorpayRefundId?: string; manualRefund?: boolean };

/** One receipt per order; Razorpay treats it as the idempotency key for each payment. */
function refundReceipt(transactionId: string): string {
  return `rf-${transactionId}`;
}

async function refund(args: { scope: StorefrontOrderScope; paymentId: string; amountPaise: number }): Promise<string> {
  const { vendorId, id: transactionId } = args.scope;
  const creds = await getVendorRazorpayCreds(vendorId);
  if (!creds) throw new OrderActionError(409, "refund_failed", "refused");
  try {
    const { refundId } = await refundPaymentViaRazorpay({
      creds,
      paymentId: args.paymentId,
      amountPaise: args.amountPaise,
      receipt: refundReceipt(transactionId),
      notes: { transactionId },
    });
    console.info(JSON.stringify({ event: "storefront_rzp_refunded", vendorId, transactionId, method: creds.kind }));
    return refundId;
  } catch (err) {
    const reason = err instanceof RazorpayRefundError ? err.reason : "unavailable";
    console.warn(JSON.stringify({ event: "storefront_rzp_refund_failed", vendorId, transactionId, method: creds.kind, reason }));
    throw new OrderActionError(409, "refund_failed", reason);
  }
}

export async function prepareOrderMoney(args: {
  scope: StorefrontOrderScope;
  action: OrderAction;
  refund?: RefundMode;
  /** MANAGER and up: `staffRoleAtLeast(ctx.staff.role, "MANAGER")`. */
  canRefund: boolean;
}): Promise<PreparedMoney> {
  const { scope, action } = args;
  if (action !== "cancel" && action !== "refund_payment_issue" && action !== "keep_payment_issue") return {};

  const order = await prisma.transaction.findFirst({
    where: scope,
    select: {
      totalPaise: true,
      paymentStatus: true,
      fulfilmentStatus: true,
      razorpayPaymentId: true,
      paymentIssue: true,
      paymentIssuePaymentId: true,
      drop: { select: { status: true } },
    },
  });
  if (!order) throw new OrderActionError(404, "Not found");

  const paidOnline = order.paymentStatus === "PAID" && order.razorpayPaymentId !== null;
  // An order marked paid by hand has no Razorpay payment: its cancel is as it always was.
  if (action === "cancel" && !paidOnline) return {};

  if (!args.canRefund) throw new OrderActionError(403, "manager_required");

  const paymentIssue = parsePaymentIssue(order.paymentIssue);
  const check = checkOrderAction(action, order.drop?.status ?? null, { ...order, paymentIssue });
  if (!check.ok) throw new OrderActionError(409, check.error);

  if (action === "keep_payment_issue") return {};
  if (action === "cancel") {
    if (args.refund === "manual") return { manualRefund: true };
    return {
      razorpayRefundId: await refund({ scope, paymentId: order.razorpayPaymentId!, amountPaise: order.totalPaise }),
    };
  }
  if (!issueOffersRefund(paymentIssue) || !order.paymentIssuePaymentId) {
    throw new OrderActionError(409, "invalid_state");
  }
  return {
    razorpayRefundId: await refund({ scope, paymentId: order.paymentIssuePaymentId, amountPaise: order.totalPaise }),
  };
}
