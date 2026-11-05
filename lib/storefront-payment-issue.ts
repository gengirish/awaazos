/**
 * What a captured Razorpay payment does to an order, once its signature, amount
 * and notes checked out. The one path for the verify route and both webhooks, so
 * they can't disagree. Rules: lib/payment-issue.ts.
 *
 * Normally that is `markOrderPaid`. The three ways it goes wrong stay on the order
 * for the seller to answer. Everything is decided inside one transaction under the
 * drop's row lock (the lock placement takes), so "oversold" can't race a new order.
 * The first issue recorded stays until it is answered; the push goes out once.
 */

import type { Prisma } from "@prisma/client";

import { markOrderPaid, orderHoldsStock, soldQtyByDropItem } from "@/lib/drops";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { issueForUnappliedCapture, type PaymentIssue } from "@/lib/payment-issue";
import { prisma } from "@/lib/prisma";
import { notifyVendorInBackground, paymentIssuePayload } from "@/lib/push";

export type CaptureResult = {
  /** This call marked the order paid (false for a repeat, or if another path won). */
  marked: boolean;
  /** An issue this call recorded; null also when an earlier one is still open. */
  issue: PaymentIssue | null;
};

async function dropIsOversold(
  tx: Prisma.TransactionClient,
  dropId: string,
  dropItemIds: string[],
  now: Date,
): Promise<boolean> {
  if (dropItemIds.length === 0) return false;
  const items = await tx.dropItem.findMany({
    where: { id: { in: dropItemIds }, dropId, maxQty: { not: null } },
    select: { id: true, maxQty: true },
  });
  if (items.length === 0) return false;
  const sold = await soldQtyByDropItem(tx, dropId, now);
  return items.some((i) => (sold.get(i.id) ?? 0) > (i.maxQty ?? 0));
}

export async function applyRazorpayCapture(args: {
  vendorId: string;
  transactionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  now?: Date;
}): Promise<CaptureResult> {
  const { vendorId, transactionId, razorpayOrderId, razorpayPaymentId } = args;
  const now = args.now ?? new Date();
  const where = { id: transactionId, vendorId, source: "STOREFRONT" as const };

  const { result, notify } = await prisma.$transaction(async (tx) => {
    const none = { result: { marked: false, issue: null } as CaptureResult, notify: null };
    const head = await tx.transaction.findFirst({ where, select: { dropId: true } });
    if (!head) return none;
    if (head.dropId) {
      await tx.$queryRaw`SELECT id FROM drops WHERE id = ${head.dropId} AND "vendorId" = ${vendorId} FOR UPDATE`;
    }

    // Read under the lock: a seller's tap may have just changed it.
    const order = await tx.transaction.findFirstOrThrow({
      where,
      select: {
        billNumber: true,
        totalPaise: true,
        createdAt: true,
        paymentMethod: true,
        paymentStatus: true,
        fulfilmentStatus: true,
        upiRef: true,
        paymentClaimedAt: true,
        razorpayPaymentId: true,
        paymentIssue: true,
        paymentIssuePaymentId: true,
        orderItems: { select: { dropItemId: true } },
      },
    });
    const holdLapsed = !orderHoldsStock(order, now);

    const marked = await markOrderPaid(tx, { vendorId, transactionId, razorpayOrderId, razorpayPaymentId, now });

    let issue: PaymentIssue | null = null;
    if (marked) {
      // A menu order has no stock to oversell, so a late payment is just a payment.
      const itemIds = order.orderItems.flatMap((i) => (i.dropItemId ? [i.dropItemId] : []));
      if (holdLapsed && head.dropId && (await dropIsOversold(tx, head.dropId, itemIds, now))) {
        issue = "paid_late_oversold";
      }
    } else {
      issue = issueForUnappliedCapture(order, razorpayPaymentId);
    }
    if (!issue) return { result: { marked, issue: null }, notify: null };

    const recorded = await tx.transaction.updateMany({
      where: {
        ...where,
        paymentIssue: null,
        // NULL never matches `not`, so say it out loud.
        OR: [{ paymentIssuePaymentId: null }, { paymentIssuePaymentId: { not: razorpayPaymentId ?? "" } }],
      },
      data: { paymentIssue: issue, paymentIssuePaymentId: razorpayPaymentId, paymentIssueAt: now },
    });
    if (recorded.count === 0) return { result: { marked, issue: null }, notify: null };
    return {
      result: { marked, issue },
      notify: { billNumber: order.billNumber, totalPaise: order.totalPaise, dropId: head.dropId, issue },
    };
  });

  if (notify) {
    console.warn(JSON.stringify({ event: "storefront_rzp_payment_issue", vendorId, transactionId, issue: notify.issue }));
    void bumpOrderSignal(vendorId);
    notifyVendorInBackground(vendorId, paymentIssuePayload(notify));
  }
  return result;
}
