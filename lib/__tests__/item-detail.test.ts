import { describe, expect, it } from "vitest";

import { deliveryFactText, dropDetailFacts, menuDetailFacts } from "@/lib/item-detail";
import { offersForItem, type ResolvedOffer } from "@/lib/offers";
import { paymentFactText } from "@/lib/store-info";

const MENU_BASE = {
  pickup: true,
  delivery: false,
  pickupNote: null,
  deliveryAreas: [],
  deliveryFeePaise: 0,
  nextSlotLabel: null,
  paymentText: "Pay by UPI",
};

describe("menuDetailFacts", () => {
  it("lists plain pickup and payment for a store with nothing else set", () => {
    expect(menuDetailFacts(MENU_BASE)).toEqual([
      { kind: "pickup", text: "Pickup" },
      { kind: "payment", text: "Pay by UPI" },
    ]);
  });

  it("puts the next slot first and names the pickup place", () => {
    expect(
      menuDetailFacts({ ...MENU_BASE, pickupNote: "  Stall 12, Exhibition Grounds ", nextSlotLabel: "Tomorrow · 12–2 pm" }),
    ).toEqual([
      { kind: "when", text: "Next slot: Tomorrow · 12–2 pm" },
      { kind: "pickup", text: "Pickup: Stall 12, Exhibition Grounds" },
      { kind: "payment", text: "Pay by UPI" },
    ]);
  });

  it("gives delivery the fee, or the store's areas when it lists them", () => {
    expect(menuDetailFacts({ ...MENU_BASE, pickup: false, delivery: true, deliveryFeePaise: 4_000 })).toEqual([
      { kind: "delivery", text: "Delivery · ₹40 fee" },
      { kind: "payment", text: "Pay by UPI" },
    ]);
    const areas = [{ name: "Kondapur", feePaise: 0 }];
    expect(deliveryFactText(areas, 4_000)).toBe("Free delivery in Kondapur");
    expect(deliveryFactText([], 0)).toBe("Free delivery");
  });

  it("leaves payment out when the store has no way to pay", () => {
    expect(menuDetailFacts({ ...MENU_BASE, paymentText: null })).toEqual([{ kind: "pickup", text: "Pickup" }]);
  });
});

describe("dropDetailFacts", () => {
  const BASE = {
    handoverText: "Pickup · Sat · 5–8 pm",
    deadlineText: "Order by Fri, 9 pm",
    delivery: false,
    pickupNote: null,
    deliveryAreas: [],
    deliveryFeePaise: 0,
    paymentText: "Pay on delivery",
  };

  it("says when, by when, and how to pay, without repeating Pickup", () => {
    expect(dropDetailFacts(BASE)).toEqual([
      { kind: "when", text: "Pickup · Sat · 5–8 pm" },
      { kind: "deadline", text: "Order by Fri, 9 pm" },
      { kind: "payment", text: "Pay on delivery" },
    ]);
  });

  it("drops the cut-off once it no longer takes orders, and adds place and delivery", () => {
    expect(
      dropDetailFacts({ ...BASE, deadlineText: null, pickupNote: "Gate 2", delivery: true, deliveryFeePaise: 3_000 }),
    ).toEqual([
      { kind: "when", text: "Pickup · Sat · 5–8 pm" },
      { kind: "pickup", text: "Pickup: Gate 2" },
      { kind: "delivery", text: "Delivery · ₹30 fee" },
      { kind: "payment", text: "Pay on delivery" },
    ]);
  });
});

describe("paymentFactText", () => {
  it("names each way to pay", () => {
    expect(paymentFactText({ upi: true, cod: true })).toBe("Pay by UPI or on delivery");
    expect(paymentFactText({ upi: true, cod: false, online: true })).toBe("Pay online");
    expect(paymentFactText({ upi: false, cod: true })).toBe("Pay on delivery");
    expect(paymentFactText({ upi: false, cod: false })).toBeNull();
  });
});

describe("offersForItem", () => {
  const offer = (id: string, eligibleItemIds: string[] | null): ResolvedOffer => ({
    id,
    name: id,
    description: null,
    minQty: 1,
    percentBps: 1000,
    eligibleItemIds,
    eligibleLabel: null,
    requiredItemIds: null,
    requiredQty: 0,
    requiredLabel: null,
    freeItem: null,
  });

  it("keeps offers that cover every item or name this one", () => {
    const offers = [offer("all", null), offer("dosa", ["dosa"]), offer("bhel", ["bhel", "lays"])];
    expect(offersForItem(offers, "bhel").map((o) => o.id)).toEqual(["all", "bhel"]);
    expect(offersForItem(offers, "chai").map((o) => o.id)).toEqual(["all"]);
    expect(offersForItem([], "bhel")).toEqual([]);
  });
});
