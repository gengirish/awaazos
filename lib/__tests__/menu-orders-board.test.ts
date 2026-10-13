import { describe, expect, it } from "vitest";

import {
  BOARD_POLL_MS,
  menuBoardWindowStart,
  menuOrdersEnableBlocker,
  toMakeFromOrders,
} from "@/lib/menu-orders-board";

describe("menuBoardWindowStart", () => {
  it("opens at IST midnight two days before today (IST)", () => {
    // Mon 5 Oct 2026, 10:00 IST
    expect(menuBoardWindowStart(new Date("2026-10-05T04:30:00.000Z")).toISOString()).toBe(
      "2026-10-02T18:30:00.000Z", // Sat 3 Oct 00:00 IST
    );
  });

  it("uses the IST calendar day, not UTC, around midnight", () => {
    // 00:30 IST on Tue 6 Oct is still 5 Oct in UTC.
    expect(menuBoardWindowStart(new Date("2026-10-05T19:00:00.000Z")).toISOString()).toBe(
      "2026-10-03T18:30:00.000Z", // Sun 4 Oct 00:00 IST
    );
    // 23:59 IST on Mon 5 Oct.
    expect(menuBoardWindowStart(new Date("2026-10-05T18:29:00.000Z")).toISOString()).toBe(
      "2026-10-02T18:30:00.000Z",
    );
  });

  it("days = 1 means today only, across a month boundary", () => {
    expect(menuBoardWindowStart(new Date("2026-11-01T02:00:00.000Z"), 1).toISOString()).toBe(
      "2026-10-31T18:30:00.000Z",
    );
  });
});

describe("toMakeFromOrders", () => {
  const order = (
    fulfilmentStatus: "PLACED" | "CONFIRMED" | "DELIVERED" | "CANCELLED",
    items: { name: string; qty: number }[],
    holdsStock = true,
    displayState: "PAID" | "EXPIRED" | "CANCELLED" | "PAY_ON_DELIVERY" = "PAID",
  ) => ({ fulfilmentStatus, holdsStock, displayState, items });

  it("sums qty per item across open orders that hold stock, biggest first", () => {
    const rows = toMakeFromOrders([
      order("PLACED", [
        { name: "Samosa", qty: 2 },
        { name: "Chai", qty: 1 },
      ]),
      order("CONFIRMED", [{ name: "Samosa", qty: 3 }], true, "PAY_ON_DELIVERY"),
      order("PLACED", [{ name: "Bun maska", qty: 1 }]),
    ]);
    expect(rows).toEqual([
      { name: "Samosa", qty: 5 },
      { name: "Bun maska", qty: 1 },
      { name: "Chai", qty: 1 },
    ]);
  });

  it("skips delivered, cancelled and expired (non-holding) orders", () => {
    expect(
      toMakeFromOrders([
        order("DELIVERED", [{ name: "Samosa", qty: 4 }]),
        order("CANCELLED", [{ name: "Samosa", qty: 4 }], false, "CANCELLED"),
        order("PLACED", [{ name: "Samosa", qty: 4 }], false, "EXPIRED"),
      ]),
    ).toEqual([]);
  });
});

describe("BOARD_POLL_MS", () => {
  it("stays above Neon's 5-minute idle timeout (scale-to-zero)", () => {
    expect(BOARD_POLL_MS).toBeGreaterThan(5 * 60_000);
  });
});

describe("menuOrdersEnableBlocker", () => {
  it("requires a published storefront first", () => {
    expect(menuOrdersEnableBlocker({ publishStorefront: false, upiId: "a@upi", acceptPayOnDelivery: true })).toBe(
      "storefront_not_published",
    );
  });

  it("requires a UPI ID or pay on delivery", () => {
    expect(menuOrdersEnableBlocker({ publishStorefront: true, upiId: null, acceptPayOnDelivery: false })).toBe(
      "no_payment_method",
    );
    expect(menuOrdersEnableBlocker({ publishStorefront: true, upiId: "  ", acceptPayOnDelivery: false })).toBe(
      "no_payment_method",
    );
    expect(menuOrdersEnableBlocker({ publishStorefront: true, upiId: "a@upi", acceptPayOnDelivery: false })).toBeNull();
    expect(menuOrdersEnableBlocker({ publishStorefront: true, upiId: null, acceptPayOnDelivery: true })).toBeNull();
  });
});
