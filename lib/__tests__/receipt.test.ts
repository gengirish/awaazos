import { describe, expect, it } from "vitest";

import {
  GSTIN_PATTERN,
  parseReceiptPaper,
  publicReceiptUrl,
  receiptPrintPath,
  receiptState,
  receiptStatusLine,
  vendorLocationLine,
  type ReceiptView,
} from "@/lib/receipt";
import { receiptsStatus } from "@/lib/settings-overview";
import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";

const view: ReceiptView = {
  vendorName: "Amma's Kitchen",
  vendorLocation: "Hyderabad, Telangana",
  gstin: "36ABCDE1234F1Z5",
  fssaiNumber: null,
  billNumber: "AWZ-20261009-0042",
  createdAt: new Date("2026-10-09T07:00:00.000Z"),
  items: [
    { name: "Biryani", qty: 2, priceInPaise: 25000 },
    { name: "Raita", qty: 1, priceInPaise: 3000 },
  ],
  subtotalPaise: 53000,
  discountPaise: 3000,
  deliveryFeePaise: 4000,
  taxPaise: 0,
  totalPaise: 54000,
  paymentMethod: "UPI",
  paymentStatus: "PAID",
  cancelled: false,
  receiptFooter: null,
  storefrontUrl: null,
  receiptUrl: "https://awaazos.example/r/tok123",
};

describe("receipt status", () => {
  it("names the payment method once paid", () => {
    expect(receiptStatusLine(view)).toBe("Paid · UPI");
    expect(receiptStatusLine({ ...view, paymentMethod: "CASH" })).toBe("Paid · Cash");
  });

  it("puts cancellation ahead of payment status", () => {
    expect(receiptState({ paymentStatus: "PAID", cancelled: true })).toBe("cancelled");
    expect(receiptStatusLine({ ...view, cancelled: true })).toBe("Cancelled");
  });

  it("spells out unpaid, refunded and failed", () => {
    expect(receiptStatusLine({ ...view, paymentStatus: "PENDING" })).toBe("Not paid yet");
    expect(receiptStatusLine({ ...view, paymentStatus: "REFUNDED" })).toBe("Refunded");
    expect(receiptStatusLine({ ...view, paymentStatus: "FAILED" })).toBe("Payment failed");
  });
});

describe("receipt helpers", () => {
  it("joins city and state, skipping blanks", () => {
    expect(vendorLocationLine("Hyderabad", "Telangana")).toBe("Hyderabad, Telangana");
    expect(vendorLocationLine("  ", "Telangana")).toBe("Telangana");
    expect(vendorLocationLine(null, null)).toBeNull();
  });

  it("validates GSTIN format", () => {
    expect(GSTIN_PATTERN.test("36ABCDE1234F1Z5")).toBe(true);
    expect(GSTIN_PATTERN.test("36abcde1234f1z5")).toBe(false);
    expect(GSTIN_PATTERN.test("36ABCDE1234F1X5")).toBe(false);
    expect(GSTIN_PATTERN.test("36ABCDE1234F1Z")).toBe(false);
  });

  it("falls back to the vendor's paper for unknown values", () => {
    expect(parseReceiptPaper("MM58", "MM80")).toBe("MM58");
    expect(parseReceiptPaper("A5", "MM80")).toBe("MM80");
    expect(parseReceiptPaper(undefined, "A4")).toBe("A4");
  });

  it("builds the public link only with both a token and a base URL", () => {
    expect(publicReceiptUrl("abc", "https://x.example/")).toBe("https://x.example/r/abc");
    expect(publicReceiptUrl(null, "https://x.example")).toBeNull();
    expect(publicReceiptUrl("abc", "  ")).toBeNull();
  });

  it("builds the print path with its flags", () => {
    expect(receiptPrintPath("AWZ-20261009-0042")).toBe("/receipts/AWZ-20261009-0042");
    expect(receiptPrintPath("AWZ-1", { autoprint: true })).toBe("/receipts/AWZ-1?autoprint=1");
    expect(receiptPrintPath("AWZ-1", { embed: true })).toBe("/receipts/AWZ-1?embed=1");
  });
});

describe("WhatsApp text from a full ReceiptView", () => {
  const msg = formatWhatsAppReceiptMessage(view);

  it("prints location and GSTIN under the shop name", () => {
    const lines = msg.split("\n");
    expect(lines[1]).toBe("Hyderabad, Telangana");
    expect(lines[2]).toBe("GSTIN: 36ABCDE1234F1Z5");
  });

  it("breaks down subtotal, discount and delivery before the total", () => {
    expect(msg).toContain("Subtotal: ₹530.00");
    expect(msg).toContain("Discount: −₹30.00");
    expect(msg).toContain("Delivery: ₹40.00");
    expect(msg).toContain("*Total: ₹540.00*");
    expect(msg.indexOf("Subtotal")).toBeLessThan(msg.indexOf("*Total"));
  });

  it("states payment and links the receipt page", () => {
    expect(msg).toContain("Paid · UPI");
    expect(msg).toContain("View receipt: https://awaazos.example/r/tok123");
  });

  it("skips the subtotal when nothing sits between it and the total", () => {
    const plain = formatWhatsAppReceiptMessage({ ...view, discountPaise: 0, deliveryFeePaise: 0, totalPaise: 53000 });
    expect(plain).not.toContain("Subtotal");
  });
});

describe("receiptsStatus", () => {
  it("summarises paper, GSTIN and auto-print", () => {
    expect(receiptsStatus({ receiptPaper: "MM80", autoPrintReceipt: false, gstin: null }).text).toBe("80 mm paper");
    expect(receiptsStatus({ receiptPaper: "MM58", autoPrintReceipt: true, gstin: "36ABCDE1234F1Z5" }).text).toBe(
      "58 mm paper · GSTIN set · auto-print on",
    );
  });
});

describe("WhatsApp text has no emoji", () => {
  it("is plain text, so no client shows a replacement character", () => {
    expect(formatWhatsAppReceiptMessage(view)).not.toMatch(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
  });
});
