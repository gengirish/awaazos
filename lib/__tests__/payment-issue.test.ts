import { describe, expect, it } from "vitest";

import { availableOrderActions, boardBucket, checkOrderAction } from "@/lib/drops-board";
import { bulkActionsFor } from "@/lib/order-bulk";
import {
  issueForUnappliedCapture,
  issueOffersRefund,
  parsePaymentIssue,
  paymentIssueCopy,
  PAYMENT_ISSUES,
  refundFailedMessage,
} from "@/lib/payment-issue";
import { paymentIssuePayload } from "@/lib/push";

const paid = { fulfilmentStatus: "CONFIRMED", paymentStatus: "PAID", paymentIssuePaymentId: null } as const;

describe("issueForUnappliedCapture", () => {
  it("a repeat of the same payment is never an issue", () => {
    expect(issueForUnappliedCapture({ ...paid, razorpayPaymentId: "pay_a" }, "pay_a")).toBeNull();
    expect(
      issueForUnappliedCapture(
        { fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED", razorpayPaymentId: "pay_a", paymentIssuePaymentId: null },
        "pay_a",
      ),
    ).toBeNull();
  });

  it("a payment already answered doesn't come back when Razorpay retries it", () => {
    expect(
      issueForUnappliedCapture(
        { fulfilmentStatus: "CANCELLED", paymentStatus: "PENDING", razorpayPaymentId: null, paymentIssuePaymentId: "pay_b" },
        "pay_b",
      ),
    ).toBeNull();
    expect(issueForUnappliedCapture({ ...paid, razorpayPaymentId: "pay_a", paymentIssuePaymentId: "pay_b" }, "pay_b")).toBeNull();
  });

  it("a payment on a cancelled order is paid_after_cancel", () => {
    expect(
      issueForUnappliedCapture(
        { fulfilmentStatus: "CANCELLED", paymentStatus: "PENDING", razorpayPaymentId: null, paymentIssuePaymentId: null },
        "pay_b",
      ),
    ).toBe("paid_after_cancel");
  });

  it("another payment on a paid order is paid_twice, including one marked paid by hand", () => {
    expect(issueForUnappliedCapture({ ...paid, razorpayPaymentId: "pay_a" }, "pay_b")).toBe("paid_twice");
    expect(issueForUnappliedCapture({ ...paid, razorpayPaymentId: null }, "pay_b")).toBe("paid_twice");
  });

  it("no payment id means nothing to tell apart or refund", () => {
    expect(issueForUnappliedCapture({ ...paid, razorpayPaymentId: null }, null)).toBeNull();
  });
});

describe("issue rules", () => {
  it("parses only known issues", () => {
    expect(parsePaymentIssue("paid_twice")).toBe("paid_twice");
    expect(parsePaymentIssue("nonsense")).toBeNull();
    expect(parsePaymentIssue(null)).toBeNull();
  });

  it("a late order is kept or cancelled, not refunded alone", () => {
    expect(issueOffersRefund("paid_after_cancel")).toBe(true);
    expect(issueOffersRefund("paid_twice")).toBe(true);
    expect(issueOffersRefund("paid_late_oversold")).toBe(false);
    expect(issueOffersRefund(null)).toBe(false);
  });

  it("every issue has copy that names the amount", () => {
    for (const issue of PAYMENT_ISSUES) {
      const copy = paymentIssueCopy(issue, "₹245.50");
      expect(copy.body).toContain("₹245.50");
      expect(copy.keepLabel.length).toBeGreaterThan(0);
    }
  });

  it("says no money moved when a refund is refused", () => {
    expect(refundFailedMessage("insufficient_balance")).toContain("balance");
    expect(refundFailedMessage("refused")).toContain("No money has moved");
    expect(refundFailedMessage("unavailable")).toContain("nothing has been refunded");
  });

  it("the push carries bill number and amount only", () => {
    const payload = paymentIssuePayload({ billNumber: "AWZ-1", totalPaise: 24_550, dropId: "d1", issue: "paid_twice" });
    expect(payload.body).toContain("AWZ-1");
    expect(payload.body).toContain("245.50");
    expect(payload.url).toContain("d1");
    expect(paymentIssuePayload({ billNumber: "AWZ-1", totalPaise: 100, dropId: null, issue: "paid_after_cancel" }).url).toBe("/orders");
  });
});

describe("the board with an open issue", () => {
  it("stays in Needs action, even cancelled", () => {
    expect(boardBucket({ displayState: "CANCELLED", fulfilmentStatus: "CANCELLED", paymentIssue: "paid_after_cancel" })).toBe(
      "needs_action",
    );
    expect(boardBucket({ displayState: "PAID", fulfilmentStatus: "CONFIRMED", paymentIssue: "paid_twice" })).toBe("needs_action");
    expect(boardBucket({ displayState: "CANCELLED", fulfilmentStatus: "CANCELLED", paymentIssue: null })).toBe("closed");
  });

  const order = (paymentIssue: (typeof PAYMENT_ISSUES)[number] | null, fulfilmentStatus: "CANCELLED" | "CONFIRMED") =>
    ({ fulfilmentStatus, paymentStatus: "PAID", paymentMethod: "UPI", paymentIssue }) as const;

  it("offers refund and keep to match the issue, on the card and in the check", () => {
    const cancelled = availableOrderActions(order("paid_after_cancel", "CANCELLED"), false);
    expect(cancelled.has("refund_payment_issue")).toBe(true);
    expect(cancelled.has("keep_payment_issue")).toBe(true);
    expect(cancelled.has("cancel")).toBe(false);

    const late = availableOrderActions(order("paid_late_oversold", "CONFIRMED"), false);
    expect(late.has("refund_payment_issue")).toBe(false);
    expect(late.has("keep_payment_issue")).toBe(true);
    expect(late.has("cancel")).toBe(true);

    expect(checkOrderAction("refund_payment_issue", null, order("paid_late_oversold", "CONFIRMED")).ok).toBe(false);
    expect(checkOrderAction("refund_payment_issue", null, order("paid_twice", "CONFIRMED")).ok).toBe(true);
    expect(checkOrderAction("keep_payment_issue", null, order(null, "CONFIRMED")).ok).toBe(false);
  });

  it("a locked list only opens up for a late order", () => {
    expect(availableOrderActions(order("paid_late_oversold", "CONFIRMED"), true).has("cancel")).toBe(true);
    expect(availableOrderActions(order("paid_twice", "CONFIRMED"), true).has("cancel")).toBe(false);
    expect(availableOrderActions(order(null, "CONFIRMED"), true).has("cancel")).toBe(false);
    expect(checkOrderAction("cancel", "FROZEN", order("paid_late_oversold", "CONFIRMED")).ok).toBe(true);
    expect(checkOrderAction("cancel", "FROZEN", order(null, "CONFIRMED"))).toEqual({ ok: false, error: "drop_frozen" });
    expect(checkOrderAction("refund_payment_issue", "FROZEN", order("paid_twice", "CONFIRMED")).ok).toBe(true);
  });

  it("money never goes through the bulk bar", () => {
    const actions = bulkActionsFor(order("paid_twice", "CONFIRMED"), false) as string[];
    expect(actions).not.toContain("refund_payment_issue");
    expect(actions).not.toContain("keep_payment_issue");
    expect(actions).not.toContain("cancel");
  });
});
