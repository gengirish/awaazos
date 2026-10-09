import { describe, expect, it } from "vitest";

import {
  formatWhatsAppReceiptMessage,
  receiptStorefrontUrl,
  receiptWhatsappUrl,
} from "@/lib/whatsapp-message";

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

  const base = {
    vendorName: "Amma's Kitchen",
    billNumber: "AWZ-20260423-0003",
    createdAt: new Date("2026-04-23T10:00:00.000Z"),
    items: [{ name: "Biryani", qty: 1, priceInPaise: 25000 }],
    taxPaise: 0,
    totalPaise: 25000,
    receiptFooter: null,
  };

  it("prints the FSSAI number when set", () => {
    const msg = formatWhatsAppReceiptMessage({ ...base, fssaiNumber: " 12345678901234 " });
    expect(msg).toContain("FSSAI Lic. No: 12345678901234");
  });

  it("omits the FSSAI line when unset or blank", () => {
    expect(formatWhatsAppReceiptMessage(base)).not.toContain("FSSAI");
    expect(formatWhatsAppReceiptMessage({ ...base, fssaiNumber: "  " })).not.toContain("FSSAI");
  });

  it("adds an order-again line when a storefront URL is given", () => {
    const msg = formatWhatsAppReceiptMessage({
      ...base,
      storefrontUrl: "https://awaazos.example/s/ammas-kitchen",
    });
    expect(msg).toContain("Order again: https://awaazos.example/s/ammas-kitchen");
    expect(msg.trimEnd().endsWith("Powered by AwaazOS")).toBe(true);
  });

  it("has no order-again line without a storefront URL", () => {
    expect(formatWhatsAppReceiptMessage(base)).not.toContain("Order again");
  });
});

describe("receiptStorefrontUrl", () => {
  it("builds the link only when the storefront is published and a base URL exists", () => {
    expect(
      receiptStorefrontUrl({ slug: "ammas-kitchen", publishStorefront: true, baseUrl: "https://a.example/" }),
    ).toBe("https://a.example/s/ammas-kitchen");
    expect(
      receiptStorefrontUrl({ slug: "ammas-kitchen", publishStorefront: false, baseUrl: "https://a.example" }),
    ).toBeNull();
    expect(
      receiptStorefrontUrl({ slug: "ammas-kitchen", publishStorefront: undefined, baseUrl: "https://a.example" }),
    ).toBeNull();
    expect(receiptStorefrontUrl({ slug: "ammas-kitchen", publishStorefront: true, baseUrl: undefined })).toBeNull();
    expect(receiptStorefrontUrl({ slug: "ammas-kitchen", publishStorefront: true, baseUrl: "  " })).toBeNull();
  });
});

describe("receiptWhatsappUrl", () => {
  it("opens a chat with the customer's number, treating 10 digits as Indian", () => {
    expect(receiptWhatsappUrl("Bill & total", "98765 43210")).toBe(
      "https://wa.me/919876543210?text=Bill%20%26%20total",
    );
    expect(receiptWhatsappUrl("x", "+91 98765-43210")).toBe("https://wa.me/919876543210?text=x");
  });

  it("falls back to WhatsApp's chat picker when no number is given", () => {
    expect(receiptWhatsappUrl("x", "")).toBe("https://wa.me/?text=x");
    expect(receiptWhatsappUrl("x", null)).toBe("https://wa.me/?text=x");
    expect(receiptWhatsappUrl("x")).toBe("https://wa.me/?text=x");
  });

  it("rejects numbers that cannot be valid", () => {
    expect(receiptWhatsappUrl("x", "12345")).toBeNull();
    expect(receiptWhatsappUrl("x", "1234567890123456")).toBeNull();
  });

  it("round-trips a multi-line receipt through the text param", () => {
    const text = "*Stall*\nBill: AWZ-1\n*Total: ₹50.00*";
    const url = receiptWhatsappUrl(text, "9876543210")!;
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
  });
});
