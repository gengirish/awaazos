import { describe, expect, it } from "vitest";

import { formatRiderHandoff, riderCollectLine, type RiderHandoffOrder } from "@/lib/delivery-handoff";

function order(over: Partial<RiderHandoffOrder> = {}): RiderHandoffOrder {
  return {
    billNumber: "AWZ-20261014-0003",
    customerName: "Priya",
    customerPhone: "+919876543210",
    deliveryAddress: "12, 3rd Cross, Yelahanka New Town",
    notes: null,
    paymentStatus: "PENDING",
    paymentMethod: "CASH",
    totalPaise: 45000,
    advancePaidPaise: 0,
    items: [
      { id: "1", dropItemId: null, name: "Banana bread", qty: 2, priceInPaise: 15000, totalPaise: 30000 },
      { id: "2", dropItemId: null, name: "Ragi laddu", qty: 1, priceInPaise: 15000, totalPaise: 15000 },
    ],
    ...over,
  };
}

describe("formatRiderHandoff", () => {
  it("gives the rider name, phone, address, items and what to collect", () => {
    expect(formatRiderHandoff(order(), " Ragi Kitchen ")).toBe(
      [
        "Delivery for Ragi Kitchen · AWZ-20261014-0003",
        "Name: Priya",
        "Phone: 98765 43210",
        "Address: 12, 3rd Cross, Yelahanka New Town",
        "Items: 2 × Banana bread, 1 × Ragi laddu",
        "Collect ₹450.00 cash",
      ].join("\n"),
    );
  });

  it("adds the buyer's note and says when the address is missing", () => {
    const text = formatRiderHandoff(order({ deliveryAddress: "  ", notes: " Ring the bell twice ", customerName: null }), "K");
    expect(text).toContain("Name: Customer");
    expect(text).toContain("Address: (not given — call the customer)");
    expect(text.endsWith("Note: Ring the bell twice")).toBe(true);
  });

  it("leaves out the phone line when there is none", () => {
    expect(formatRiderHandoff(order({ customerPhone: null }), "K")).not.toContain("Phone:");
  });
});

describe("riderCollectLine", () => {
  it("says nothing to collect once paid", () => {
    expect(riderCollectLine(order({ paymentStatus: "PAID", paymentMethod: "UPI" }))).toBe("Paid — nothing to collect");
  });

  it("flags an unpaid UPI order", () => {
    expect(riderCollectLine(order({ paymentMethod: "UPI" }))).toMatch(/^Not paid yet — collect ₹450/);
  });

  it("collects only the balance after an advance", () => {
    expect(riderCollectLine(order({ advancePaidPaise: 20000 }))).toBe("Collect ₹250.00 cash");
  });
});
