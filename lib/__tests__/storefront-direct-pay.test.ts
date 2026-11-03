import { describe, expect, it } from "vitest";

import {
  checkoutCancelledMessage,
  checkoutLoadFailedMessage,
  startErrorMessage,
  startErrorOpensDirectPay,
} from "@/lib/storefront-direct-pay";

describe("startErrorOpensDirectPay", () => {
  it.each(["online_payment_unavailable", "razorpay_unavailable", "Internal server error", undefined])(
    "opens direct pay when Razorpay can't take the payment (%s)",
    (error) => {
      expect(startErrorOpensDirectPay(error)).toBe(true);
    },
  );

  it.each(["payment_processing", "not_awaiting_payment", "order_expired", "rate_limited"])(
    "stays closed for %s, where paying directly could charge twice or is pointless",
    (error) => {
      expect(startErrorOpensDirectPay(error)).toBe(false);
    },
  );
});

describe("failure copy names only a way out the store has", () => {
  const texts = (fallback: "upi" | "message" | null) => [
    startErrorMessage("online_payment_unavailable", fallback),
    startErrorMessage("razorpay_unavailable", fallback),
    startErrorMessage(undefined, fallback),
    checkoutLoadFailedMessage(fallback),
    checkoutCancelledMessage(fallback),
  ];

  it("points at UPI when the store has a UPI ID", () => {
    for (const text of texts("upi")) expect(text).toMatch(/pay by UPI below\.$/);
  });

  it("points at the store when it can only be messaged", () => {
    for (const text of texts("message")) {
      expect(text).toMatch(/message the store to pay\.$/);
      expect(text).not.toMatch(/UPI/);
    }
  });

  it("promises nothing when there is no way out", () => {
    for (const text of texts(null)) {
      expect(text).not.toMatch(/UPI|message the store/);
      expect(text).toMatch(/\.$/);
    }
  });

  it("never offers UPI on an error that keeps it closed", () => {
    for (const error of ["payment_processing", "not_awaiting_payment", "order_expired", "rate_limited"]) {
      expect(startErrorMessage(error, "upi")).not.toMatch(/pay by UPI/);
    }
  });
});
