import { describe, expect, it } from "vitest";

import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";

describe("formatWhatsAppReceiptMessage", () => {
  it("includes vendor header, bill line, items, total, and footer", () => {
    const msg = formatWhatsAppReceiptMessage({
      vendorName: "Ravi's Bhel",
      billNumber: "AWZ-20260423-0007",
      createdAt: new Date("2026-04-23T08:15:00.000Z"),
      items: [
        { name: "Bhel", qty: 2, priceInPaise: 5000 },
        { name: "Nimbu Pani", qty: 1, priceInPaise: 2000 },
      ],
      taxPaise: 500,
      totalPaise: 12500,
      receiptFooter: "Visit again!",
    });

    expect(msg).toContain("*Ravi's Bhel*");
    expect(msg).toContain("Bill: AWZ-20260423-0007");
    expect(msg).toContain("2 × Bhel");
    expect(msg).toContain("Tax:");
    expect(msg).toContain("*Total:");
    expect(msg).toContain("Visit again!");
    expect(msg).toContain("AwaazOS");
  });

  it("omits tax line when tax is zero", () => {
    const msg = formatWhatsAppReceiptMessage({
      vendorName: "Stall",
      billNumber: "AWZ-20260423-0001",
      createdAt: new Date("2026-04-23T10:00:00.000Z"),
      items: [{ name: "Chai", qty: 1, priceInPaise: 1000 }],
      taxPaise: 0,
      totalPaise: 1000,
      receiptFooter: null,
    });
    expect(msg).not.toContain("Tax:");
  });

  it("prints HSN/SAC lines when provided on receipt items", () => {
    const msg = formatWhatsAppReceiptMessage({
      vendorName: "Stall",
      billNumber: "AWZ-20260423-0002",
      createdAt: new Date("2026-04-23T10:00:00.000Z"),
      items: [{ name: "Idli", qty: 2, priceInPaise: 3000, hsnCode: "2106" }],
      taxPaise: 0,
      totalPaise: 6000,
      receiptFooter: null,
    });
    expect(msg).toContain("HSN/SAC: 2106");
  });
});
