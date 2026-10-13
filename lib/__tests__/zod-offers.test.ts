import { describe, expect, it } from "vitest";

import { offersStatus } from "@/lib/settings-overview";
import { formatWhatsAppOrderMessage } from "@/lib/storefront-order";
import { checkTransactionTotals, transactionPostBodySchema } from "@/lib/transaction-post-body";
import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";
import {
  offerDatesToDays,
  offerInputToData,
  offerToggleSchema,
  offerUpsertSchema,
  parsePercentInput,
  percentInputFromBps,
} from "@/lib/zod-offers";

const weekly = {
  name: " Weekly Plan ",
  eligibility: "TAG",
  eligibleTag: " Quiche ",
  minQty: 4,
  requiredTag: "Paneer",
  requiredTagQty: 1,
  percentBps: 1000,
};

describe("offerUpsertSchema", () => {
  it("accepts the Weekly Plan and normalises tags", () => {
    const data = offerInputToData(offerUpsertSchema.parse(weekly));
    expect(data).toMatchObject({
      name: "Weekly Plan",
      eligibility: "TAG",
      eligibleTag: "quiche",
      eligibleItemIds: [],
      requiredTag: "paneer",
      requiredTagQty: 1,
      discountType: "PERCENT",
      percentBps: 1000,
      onMenuOrders: true,
      onDrops: true,
      onPos: true,
      isActive: true,
      startsAt: null,
      endsAt: null,
    });
  });

  it("rejects the rules that cannot be priced", () => {
    const bad = (over: Record<string, unknown>) => offerUpsertSchema.safeParse({ ...weekly, ...over }).success;
    expect(bad({ eligibleTag: "  " })).toBe(false);
    expect(bad({ eligibility: "ITEMS", eligibleItemIds: [] })).toBe(false);
    expect(bad({ requiredTagQty: 5 })).toBe(false); // more than minQty
    expect(bad({ requiredTag: null, requiredTagQty: 1 })).toBe(false);
    expect(bad({ requiredTagQty: 0 })).toBe(false); // tag without a count
    expect(bad({ percentBps: 0 })).toBe(false);
    expect(bad({ percentBps: 10_000 })).toBe(false);
    expect(bad({ minQty: 0 })).toBe(false);
    expect(bad({ onMenuOrders: false, onDrops: false, onPos: false })).toBe(false);
    expect(bad({ startsOn: "2026-10-20", endsOn: "2026-10-19" })).toBe(false);
    expect(bad({ startsOn: "2026-02-30" })).toBe(false);
  });

  it("keeps fixed amount and bundle price for later", () => {
    expect(offerUpsertSchema.safeParse({ ...weekly, discountType: "BUNDLE_PRICE" }).success).toBe(false);
    expect(offerUpsertSchema.safeParse({ ...weekly, discountType: "FIXED_AMOUNT" }).success).toBe(false);
  });

  it("runs from the start of one IST day to the end of another", () => {
    const data = offerInputToData(offerUpsertSchema.parse({ ...weekly, startsOn: "2026-10-13", endsOn: "2026-10-19" }));
    expect(data.startsAt?.toISOString()).toBe("2026-10-12T18:30:00.000Z");
    expect(data.endsAt?.toISOString()).toBe("2026-10-19T18:30:00.000Z");
    expect(offerDatesToDays(data)).toEqual({ startsOn: "2026-10-13", endsOn: "2026-10-19" });
  });

  it("drops what the chosen scope does not use", () => {
    const data = offerInputToData(
      offerUpsertSchema.parse({ ...weekly, eligibleItemIds: ["x"], onDrops: false, dropIds: ["d1"] }),
    );
    expect(data.eligibleItemIds).toEqual([]);
    expect(data.dropIds).toEqual([]);
  });

  it("the switch accepts isActive alone", () => {
    expect(offerToggleSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(offerToggleSchema.safeParse({ isActive: false, percentBps: 9000 }).success).toBe(false);
  });
});

describe("percent input", () => {
  it("parses by string into basis points", () => {
    expect(parsePercentInput("10")).toBe(1000);
    expect(parsePercentInput(" 12.5 ")).toBe(1250);
    expect(parsePercentInput("7.05")).toBe(705);
    expect(parsePercentInput("0.5")).toBe(50);
    expect(parsePercentInput("")).toBeNull();
    expect(parsePercentInput("10%")).toBeNull();
    expect(parsePercentInput("1.234")).toBeNull();
    expect(parsePercentInput("100")).toBeNull();
  });

  it("round-trips", () => {
    for (const bps of [1000, 1250, 705, 9000]) expect(parsePercentInput(percentInputFromBps(bps))).toBe(bps);
  });
});

describe("offers on bills and messages", () => {
  const receipt = {
    vendorName: "The Flavours of Millets",
    billNumber: "AWZ-20261013-0001",
    createdAt: new Date("2026-10-13T07:00:00.000Z"),
    items: [
      { name: "Potato Corn Capsicum Quiche", qty: 3, priceInPaise: 5500 },
      { name: "Paneer Carrot Zucchini Quiche", qty: 1, priceInPaise: 10000 },
    ],
    subtotalPaise: 26500,
    discountPaise: 2650,
    offerName: "Weekly Plan",
    deliveryFeePaise: 3000,
    // 5% GST on the discounted value: floor((26500 − 2650) × 500 / 10000).
    taxPaise: 1192,
    totalPaise: 28042,
  };

  it("the receipt names the offer and its totals reconcile", () => {
    const msg = formatWhatsAppReceiptMessage(receipt);
    expect(msg).toContain("Subtotal: ₹265.00");
    expect(msg).toContain("Discount (Weekly Plan): −₹26.50");
    expect(msg).toContain("Tax: ₹11.92");
    expect(msg).toContain("*Total: ₹280.42*");
    expect(receipt.taxPaise).toBe(Math.floor(((receipt.subtotalPaise - receipt.discountPaise) * 500) / 10_000));
    expect(receipt.subtotalPaise - receipt.discountPaise + receipt.deliveryFeePaise + receipt.taxPaise).toBe(
      receipt.totalPaise,
    );
    expect(receipt.items.reduce((s, i) => s + i.priceInPaise * i.qty, 0)).toBe(receipt.subtotalPaise);
  });

  it("an older bill with a discount but no offer still prints", () => {
    expect(formatWhatsAppReceiptMessage({ ...receipt, offerName: null })).toContain("Discount: −₹26.50");
  });

  it("the buyer's WhatsApp order message carries the discount line", () => {
    const msg = formatWhatsAppOrderMessage({
      vendorName: "The Flavours of Millets",
      billNumber: "AWZ-20261013-0001",
      items: [{ name: "Quiche", qty: 4, totalPaise: 26500 }],
      discountPaise: 2650,
      offerName: "Weekly Plan",
      deliveryFeePaise: 0,
      totalPaise: 23850,
      paymentMethod: "UPI",
      fulfilmentType: "PICKUP",
      deliveryAddress: null,
      customerName: null,
      notes: null,
      orderUrl: null,
    });
    expect(msg).toContain("Discount (Weekly Plan) - −₹26.50");
    expect(msg).toContain("*Total: ₹238.50*");
  });
});

describe("counter sale body", () => {
  it("still parses a body from a POS that knows nothing of offers", () => {
    const parsed = transactionPostBodySchema.parse({
      items: [{ name: "Chai", priceInPaise: 1000, qty: 1 }],
      subtotalPaise: 1000,
      taxPaise: 0,
      totalPaise: 1000,
      paymentMethod: "CASH",
    });
    expect(parsed.discountPaise).toBe(0);
    expect(parsed.offerId).toBeUndefined();
  });

  it("checks the arithmetic with a discount and refuses one larger than the bill", () => {
    const items = [{ priceInPaise: 5500, qty: 4 }];
    expect(
      checkTransactionTotals({ items, subtotalPaise: 22000, discountPaise: 2200, taxPaise: 990, totalPaise: 20790 }),
    ).toEqual({ ok: true });
    expect(
      checkTransactionTotals({ items, subtotalPaise: 22000, discountPaise: 2200, taxPaise: 0, totalPaise: 22000 }),
    ).toEqual({ ok: false, code: "total_mismatch" });
    expect(
      checkTransactionTotals({ items, subtotalPaise: 22000, discountPaise: 22001, taxPaise: 0, totalPaise: -1 }),
    ).toEqual({ ok: false, code: "discount_mismatch" });
  });
});

describe("offersStatus", () => {
  it("counts the offers switched on", () => {
    expect(offersStatus(0)).toEqual({ text: "No offers on", on: false });
    expect(offersStatus(1)).toEqual({ text: "1 offer on", on: true });
    expect(offersStatus(2)).toEqual({ text: "2 offers on", on: true });
  });
});
