/**
 * When a Razorpay payment lands somewhere it shouldn't: on a cancelled order, on
 * an already paid order, or late enough to oversell a drop. Pure and client-safe;
 * the database side is lib/storefront-payment-issue.ts.
 *
 * Razorpay has the buyer's money in all three, so none is only a log line: the
 * order carries the issue on the seller's board until they answer it. Refunding is
 * the store's own Razorpay refund (lib/storefront-order-refund.ts), MANAGER and up.
 *
 * `paymentIssuePaymentId` survives the answer on purpose: Razorpay sends one payment
 * as `payment.captured` and `order.paid` and retries both, so a repeat of an answered
 * payment must not raise the issue again.
 */

import type { FulfilmentStatus, PaymentStatus } from "@prisma/client";

export const PAYMENT_ISSUES = ["paid_after_cancel", "paid_late_oversold", "paid_twice"] as const;
export type PaymentIssue = (typeof PAYMENT_ISSUES)[number];

export function parsePaymentIssue(value: string | null | undefined): PaymentIssue | null {
  return PAYMENT_ISSUES.find((i) => i === value) ?? null;
}

/** The flagged payment is money to give back. A late order is kept or cancelled instead. */
export function issueOffersRefund(issue: PaymentIssue | null | undefined): boolean {
  return issue === "paid_after_cancel" || issue === "paid_twice";
}

/** The issue a captured payment raises when `markOrderPaid` didn't apply it; null = nothing wrong. */
export function issueForUnappliedCapture(
  o: {
    fulfilmentStatus: FulfilmentStatus | null;
    paymentStatus: PaymentStatus;
    razorpayPaymentId: string | null;
    paymentIssuePaymentId: string | null;
  },
  paymentId: string | null,
): PaymentIssue | null {
  // With no payment id there is nothing to tell apart or to refund.
  if (!paymentId) return null;
  // The same payment again: `order.paid` after `payment.captured`, a retry, verify.
  if (paymentId === o.razorpayPaymentId || paymentId === o.paymentIssuePaymentId) return null;
  if (o.fulfilmentStatus === "CANCELLED") return "paid_after_cancel";
  return o.paymentStatus === "PAID" ? "paid_twice" : null;
}

/** "Razorpay keeps its fee" is from its refund docs: the fee charged at capture is not reversed. */
export const REFUND_TERMS =
  "The money goes back from your Razorpay balance, usually within a week. Razorpay keeps its fee on the original payment.";

export const REFUND_MANAGER_ONLY = "Ask a manager or the owner to do this: it sends money back to the customer.";

export function paymentIssueCopy(
  issue: PaymentIssue,
  amountLabel: string,
): { title: string; body: string; keepLabel: string; pushBody: string } {
  switch (issue) {
    case "paid_after_cancel":
      return {
        title: "Paid after you cancelled",
        body: `The customer paid ${amountLabel} online after this order was cancelled. Razorpay has the money, so refund it or make the order.`,
        keepLabel: "I'll refund from Razorpay",
        pushBody: `paid after it was cancelled. Refund it from the orders board`,
      };
    case "paid_late_oversold":
      return {
        title: "Paid late, and you're oversold",
        body: `The customer paid ${amountLabel} after their hold ran out, and these items had sold out by then. Make extra, or cancel and refund.`,
        keepLabel: "Keep order, I'll make extra",
        pushBody: `paid late and you're oversold. Keep it or refund it`,
      };
    case "paid_twice":
      return {
        title: "Paid twice?",
        body: `Razorpay took ${amountLabel} for an order that was already marked paid. If the customer paid twice, refund this payment. The order stays as it is.`,
        keepLabel: "Not a double payment",
        pushBody: `may have been paid twice. Check it on the orders board`,
      };
  }
}

/** Why Razorpay didn't take a refund. Whatever the reason, no money has moved. */
export type RefundFailure = "insufficient_balance" | "refused" | "unavailable";

export function refundFailedMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "insufficient_balance":
      return "Razorpay couldn't refund this: your Razorpay balance is too low. Add funds in Razorpay or wait for more payments, then try again. No money has moved.";
    case "unavailable":
      return "We couldn't reach Razorpay, so nothing has been refunded yet. Please try again.";
    default:
      return "Razorpay didn't accept this refund. No money has moved. You can try again, or refund from your Razorpay dashboard.";
  }
}
