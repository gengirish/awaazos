import { describe, expect, it } from "vitest";

import { storeInfoFacts } from "@/lib/store-info";

const BASE = {
  menuOrdering: true,
  fulfilmentMode: "BOTH" as const,
  deliveryFeePaise: 4_000,
  hasDrops: false,
  upi: true,
  cod: true,
  fssaiNumber: null,
};

describe("storeInfoFacts", () => {
  it("lists handover, payment and licence for an ordering menu", () => {
    expect(storeInfoFacts({ ...BASE, fssaiNumber: " 12345678901234 " })).toEqual([
      { kind: "pickup", text: "Pickup" },
      { kind: "delivery", text: "Delivery · ₹40 fee" },
      { kind: "payment", text: "Pay by UPI or on delivery" },
      { kind: "fssai", text: "FSSAI Lic. No. 12345678901234" },
    ]);
  });

  it("says free delivery and drops pickup for a delivery-only menu", () => {
    const facts = storeInfoFacts({ ...BASE, fulfilmentMode: "DELIVERY", deliveryFeePaise: 0 });
    expect(facts.map((f) => f.text)).toEqual(["Free delivery", "Pay by UPI or on delivery"]);
  });

  it("leaves handover to the drop cards when only drops take orders", () => {
    const facts = storeInfoFacts({ ...BASE, menuOrdering: false, hasDrops: true, cod: false });
    expect(facts).toEqual([{ kind: "payment", text: "Pay by UPI" }]);
  });

  it("says nothing about paying when nothing can be ordered", () => {
    expect(storeInfoFacts({ ...BASE, menuOrdering: false })).toEqual([]);
    expect(storeInfoFacts({ ...BASE, menuOrdering: false, fssaiNumber: "1" })).toEqual([
      { kind: "fssai", text: "FSSAI Lic. No. 1" },
    ]);
  });

  it("omits payment when no method is set up", () => {
    const facts = storeInfoFacts({ ...BASE, fulfilmentMode: "PICKUP", upi: false, cod: false });
    expect(facts).toEqual([{ kind: "pickup", text: "Pickup" }]);
  });
});
