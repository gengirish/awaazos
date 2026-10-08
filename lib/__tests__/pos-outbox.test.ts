import { describe, expect, it } from "vitest";

import { classifyStatus, pendingTodayPaise, syncOrder, type OutboxSale } from "@/lib/pos-outbox";

function sale(over: Partial<OutboxSale>): OutboxSale {
  return {
    clientRef: "3b241101-e2bb-4255-8caf-4136c566a962",
    vendorId: "v1",
    clientCreatedAt: "2026-10-07T06:00:00.000Z",
    localNo: 1,
    body: {
      items: [{ name: "Chai", priceInPaise: 1500, qty: 2 }],
      subtotalPaise: 3000,
      taxPaise: 0,
      totalPaise: 3000,
      paymentMethod: "CASH",
      upiRef: null,
    },
    status: "pending",
    ...over,
  };
}

describe("classifyStatus", () => {
  it.each([
    [200, "ok"],
    [201, "ok"],
    [401, "auth"],
    // The account on this device can't reach the entry's vendor: keep it.
    [404, "auth"],
    [408, "retry"],
    [409, "retry"], // same Idempotency-Key still in flight
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [400, "rejected"],
    [402, "rejected"],
    [403, "rejected"],
    [422, "rejected"],
  ] as const)("%i → %s", (status, kind) => {
    expect(classifyStatus(status)).toBe(kind);
  });
});

describe("pendingTodayPaise", () => {
  const now = new Date("2026-10-07T12:00:00.000Z"); // 17:30 IST

  it("sums pending sales from today's IST day only", () => {
    const sales = [
      sale({ localNo: 1, clientCreatedAt: "2026-10-07T06:00:00.000Z" }),
      // 00:10 IST on 7 Oct counts as today…
      sale({ localNo: 2, clientCreatedAt: "2026-10-06T18:40:00.000Z" }),
      // …23:50 IST on 6 Oct does not.
      sale({ localNo: 3, clientCreatedAt: "2026-10-06T18:20:00.000Z" }),
    ];
    expect(pendingTodayPaise(sales, now)).toBe(6000);
  });

  it("ignores failed sales", () => {
    expect(pendingTodayPaise([sale({ status: "failed", failCode: "client_time_too_old" })], now)).toBe(0);
  });
});

describe("syncOrder", () => {
  it("sends pending sales oldest first and skips failed ones", () => {
    const a = sale({ localNo: 1, clientRef: "a", clientCreatedAt: "2026-10-07T06:00:00.000Z" });
    const b = sale({ localNo: 2, clientRef: "b", clientCreatedAt: "2026-10-07T05:00:00.000Z" });
    const c = sale({ localNo: 3, clientRef: "c", status: "failed" });
    expect(syncOrder([a, b, c]).map((s) => s.clientRef)).toEqual(["b", "a"]);
  });

  it("breaks ties on the local number", () => {
    const t = "2026-10-07T06:00:00.000Z";
    const x = sale({ localNo: 5, clientRef: "x", clientCreatedAt: t });
    const y = sale({ localNo: 4, clientRef: "y", clientCreatedAt: t });
    expect(syncOrder([x, y]).map((s) => s.clientRef)).toEqual(["y", "x"]);
  });
});
