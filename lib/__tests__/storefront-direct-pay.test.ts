import { describe, expect, it } from "vitest";

import {
  checkoutCancelledMessage,
  checkoutLoadFailedMessage,
  directPayOfferLabel,
  orderPagePath,
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

describe("closing Razorpay's window", () => {
  it("promises no other way to pay: that is the link's job", () => {
    expect(checkoutCancelledMessage()).toBe("Payment cancelled. You can try again.");
  });

  it("offers only a way out the store has", () => {
    expect(directPayOfferLabel("upi")).toBe("Pay by UPI instead");
    expect(directPayOfferLabel("message")).toBe("Message the store instead");
    expect(directPayOfferLabel(null)).toBeNull();
  });
});

describe("orderPagePath", () => {
  it("adds pay=1 only for a Razorpay order", () => {
    expect(orderPagePath("my-store", "tok", { viaWhatsapp: false, payNow: true })).toBe("/s/my-store/o/tok?pay=1");
    expect(orderPagePath("my-store", "tok", { viaWhatsapp: false, payNow: false })).toBe("/s/my-store/o/tok");
  });

  it("lets WhatsApp go first", () => {
    expect(orderPagePath("my-store", "tok", { viaWhatsapp: true, payNow: true })).toBe("/s/my-store/o/tok?wa=1");
  });

  it("encodes both path parts", () => {
    expect(orderPagePath("a b", "c/d", { viaWhatsapp: false, payNow: false })).toBe("/s/a%20b/o/c%2Fd");
  });
});

describe("failure copy names only a way out the store has", () => {
  const texts = (fallback: "upi" | "message" | null) => [
    startErrorMessage("online_payment_unavailable", fallback),
    startErrorMessage("razorpay_unavailable", fallback),
    startErrorMessage(undefined, fallback),
    checkoutLoadFailedMessage(fallback),
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
