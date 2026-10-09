import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storefront-razorpay", () => ({ appBaseUrl: () => "https://awaazos.example" }));

import { generateReceiptToken, receiptPaymentStatus } from "@/lib/receipt-data";

describe("receiptPaymentStatus", () => {
  it("shows a counter UPI sale without a UTR as paid: the cashier tapped Mark paid", () => {
    expect(receiptPaymentStatus({ source: "MANUAL", paymentStatus: "PENDING" })).toBe("PAID");
    expect(receiptPaymentStatus({ source: "VOICE", paymentStatus: "PENDING" })).toBe("PAID");
  });

  it("keeps a storefront order's real status", () => {
    expect(receiptPaymentStatus({ source: "STOREFRONT", paymentStatus: "PENDING" })).toBe("PENDING");
    expect(receiptPaymentStatus({ source: "STOREFRONT", paymentStatus: "PAID" })).toBe("PAID");
  });

  it("never hides a refund or failure", () => {
    expect(receiptPaymentStatus({ source: "MANUAL", paymentStatus: "REFUNDED" })).toBe("REFUNDED");
    expect(receiptPaymentStatus({ source: "MANUAL", paymentStatus: "FAILED" })).toBe("FAILED");
  });
});

describe("generateReceiptToken", () => {
  it("is 32 url-safe characters and unique", () => {
    const a = generateReceiptToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generateReceiptToken()).not.toBe(a);
  });
});
