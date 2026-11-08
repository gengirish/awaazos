import { describe, expect, it } from "vitest";

import { buyerUpdateMessage } from "@/lib/drops-board";
import {
  mergeOrderAgainLines,
  orderIsOver,
  orderItemsSummary,
  planOrderAgain,
  type OrderableNow,
} from "@/lib/order-again";

const items = [
  { menuItemId: "samosa", name: "Samosa", qty: 2 },
  { menuItemId: "chai", name: "Chai", qty: 1 },
  { menuItemId: null, name: "Deleted dish", qty: 1 },
];
const nothing: OrderableNow = { menu: new Set(), drops: [] };

describe("planOrderAgain", () => {
  it("fills the menu cart and names what can't be ordered", () => {
    expect(planOrderAgain(items, { ...nothing, menu: new Set(["samosa"]) })).toEqual({
      scope: { kind: "menu" },
      lines: { samosa: 2 },
      unavailable: ["Chai", "Deleted dish"],
    });
  });

  it("uses drop item ids for a drop", () => {
    const drops = [{ dropId: "d1", items: new Map([["samosa", "di-samosa"]]) }];
    expect(planOrderAgain(items, { ...nothing, drops })).toMatchObject({
      scope: { kind: "drop", dropId: "d1" },
      lines: { "di-samosa": 2 },
    });
  });

  it("picks whichever takes the most; the menu wins a tie, then the first drop", () => {
    const one = new Map([["samosa", "a"]]);
    const two = new Map([
      ["samosa", "b1"],
      ["chai", "b2"],
    ]);
    const menu = new Set(["samosa"]);
    expect(planOrderAgain(items, { menu, drops: [{ dropId: "d2", items: two }] })?.scope).toEqual({
      kind: "drop",
      dropId: "d2",
    });
    expect(planOrderAgain(items, { menu, drops: [{ dropId: "d1", items: one }] })?.scope).toEqual({ kind: "menu" });
    expect(
      planOrderAgain(items, {
        ...nothing,
        drops: [
          { dropId: "soon", items: one },
          { dropId: "later", items: one },
        ],
      })?.scope,
    ).toEqual({ kind: "drop", dropId: "soon" });
  });

  it("adds up repeated lines and is null when nothing can be ordered", () => {
    const twice = [
      { menuItemId: "chai", name: "Chai", qty: 1 },
      { menuItemId: "chai", name: "Chai", qty: 2 },
    ];
    expect(planOrderAgain(twice, { ...nothing, menu: new Set(["chai"]) })?.lines).toEqual({ chai: 3 });
    expect(planOrderAgain(items, nothing)).toBeNull();
  });
});

describe("mergeOrderAgainLines", () => {
  it("keeps the saved cart and doesn't double on a second tap", () => {
    const once = mergeOrderAgainLines({ vada: 1 }, { samosa: 2 });
    expect(once).toEqual({ vada: 1, samosa: 2 });
    expect(mergeOrderAgainLines(once, { samosa: 2 })).toEqual(once);
  });
});

describe("orderIsOver", () => {
  it("is true only once nothing more can happen to the order", () => {
    expect(orderIsOver("DELIVERED", "DELIVERED")).toBe(true);
    expect(orderIsOver("CANCELLED", "CANCELLED")).toBe(true);
    expect(orderIsOver("EXPIRED", "PLACED")).toBe(true);
    expect(orderIsOver("AWAITING_PAYMENT", "PLACED")).toBe(false);
    expect(orderIsOver("PAID", "CONFIRMED")).toBe(false);
  });
});

describe("orderItemsSummary", () => {
  it("names the first items and counts the rest", () => {
    expect(orderItemsSummary(items)).toBe("2 × Samosa, 1 × Chai +1 more");
    expect(orderItemsSummary(items.slice(0, 1))).toBe("2 × Samosa");
    expect(orderItemsSummary([])).toBe("");
  });
});

describe("buyerUpdateMessage", () => {
  const order = {
    billNumber: "AWZ-1",
    customerName: "Priya Rao",
    fulfilmentType: "PICKUP" as const,
    fulfilmentStatus: "CONFIRMED" as const,
    outForDeliveryAt: null,
  };
  const url = "https://x.test/s/a/o/t";

  it("follows the order's status, first name only", () => {
    expect(buyerUpdateMessage(order, "Sam", url)).toBe(
      `Hi Priya, your order AWZ-1 from Sam is confirmed.\nYour order: ${url}`,
    );
    expect(buyerUpdateMessage(order, "Sam", url, true)).toContain("is ready for pickup.");
    expect(
      buyerUpdateMessage(
        { ...order, fulfilmentType: "DELIVERY", outForDeliveryAt: "2026-11-03T10:00:00.000Z" },
        "Sam",
        url,
      ),
    ).toContain("is on the way.");
    expect(buyerUpdateMessage({ ...order, fulfilmentStatus: "DELIVERED" }, "Sam", url)).toContain("was picked up.");
    expect(buyerUpdateMessage({ ...order, fulfilmentType: "DELIVERY", fulfilmentStatus: "DELIVERED" }, "Sam", url)).toContain(
      "was delivered.",
    );
  });

  it("leaves an open-ended message for the seller to finish, with no link", () => {
    expect(buyerUpdateMessage({ ...order, fulfilmentStatus: "PLACED" }, "Sam", url)).toBe(
      "Hi Priya, about your order AWZ-1 from Sam: ",
    );
    expect(buyerUpdateMessage({ ...order, fulfilmentStatus: "CANCELLED" }, "Sam", url)).toBe(
      "Hi Priya, your order AWZ-1 from Sam has been cancelled: ",
    );
  });

  it("copes with no name and no link yet", () => {
    expect(buyerUpdateMessage({ ...order, customerName: null }, "Sam", null)).toBe(
      "Hi there, your order AWZ-1 from Sam is confirmed.",
    );
  });
});
