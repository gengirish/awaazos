import { describe, expect, it } from "vitest";

import {
  dropWillTakeOrders,
  dropWillTakeOrdersWhere,
  hasPaymentMethod,
  lastPaymentMethodBlockers,
  type PaymentGuardBlocker,
} from "../payment-guard";

const NOW = new Date("2026-10-07T06:30:00.000Z");
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

// A drop's stored state. "scheduled" = OPEN with a future opensAt (opensAt is
// not part of the guard's input: an OPEN drop before its cut-off counts either way).
const DROPS = {
  none: [],
  open: [{ status: "OPEN" as const, closesAt: at(5 * HOUR) }],
  scheduled: [{ status: "OPEN" as const, closesAt: at(48 * HOUR), opensAt: at(24 * HOUR) }],
  closed: [
    { status: "CLOSED" as const, closesAt: at(5 * HOUR) },
    { status: "OPEN" as const, closesAt: at(-HOUR) }, // past cut-off = effectively CLOSED
  ],
};

const METHODS = {
  upiOnly: { upiId: "stall@okaxis", acceptPayOnDelivery: false },
  podOnly: { upiId: null, acceptPayOnDelivery: true },
  both: { upiId: "stall@okaxis", acceptPayOnDelivery: true },
  none: { upiId: null, acceptPayOnDelivery: false },
};

describe("hasPaymentMethod", () => {
  it("UPI ID or pay on delivery counts; blank / whitespace UPI does not", () => {
    expect(hasPaymentMethod(METHODS.upiOnly)).toBe(true);
    expect(hasPaymentMethod(METHODS.podOnly)).toBe(true);
    expect(hasPaymentMethod(METHODS.both)).toBe(true);
    expect(hasPaymentMethod(METHODS.none)).toBe(false);
    expect(hasPaymentMethod({ upiId: "", acceptPayOnDelivery: false })).toBe(false);
    expect(hasPaymentMethod({ upiId: "   ", acceptPayOnDelivery: false })).toBe(false);
    expect(hasPaymentMethod({ upiId: undefined, acceptPayOnDelivery: false })).toBe(false);
  });
});

describe("dropWillTakeOrders", () => {
  it("stored OPEN before its cut-off (open now or scheduled) counts", () => {
    expect(dropWillTakeOrders(DROPS.open[0]!, NOW)).toBe(true);
    expect(dropWillTakeOrders(DROPS.scheduled[0]!, NOW)).toBe(true);
  });

  it("past the cut-off, or any other stored status, does not", () => {
    expect(dropWillTakeOrders({ status: "OPEN", closesAt: NOW }, NOW)).toBe(false);
    expect(dropWillTakeOrders({ status: "OPEN", closesAt: at(-1) }, NOW)).toBe(false);
    for (const status of ["DRAFT", "CLOSED", "FROZEN", "FULFILLED"] as const) {
      expect(dropWillTakeOrders({ status, closesAt: at(HOUR) }, NOW)).toBe(false);
    }
  });

  it("the Prisma where matches the same rule", () => {
    expect(dropWillTakeOrdersWhere(NOW)).toEqual({ status: "OPEN", closesAt: { gt: NOW } });
  });
});

describe("lastPaymentMethodBlockers — every combination", () => {
  const cases: [keyof typeof METHODS, boolean, keyof typeof DROPS, PaymentGuardBlocker[]][] = [];
  for (const m of Object.keys(METHODS) as (keyof typeof METHODS)[]) {
    for (const menu of [true, false]) {
      for (const d of Object.keys(DROPS) as (keyof typeof DROPS)[]) {
        const expected: PaymentGuardBlocker[] = [];
        if (m === "none") {
          if (menu) expected.push("menu_orders");
          if (d === "open" || d === "scheduled") expected.push("open_drop");
        }
        cases.push([m, menu, d, expected]);
      }
    }
  }

  it.each(cases)("%s · menu orders %s · drop %s → %j", (m, menu, d, expected) => {
    expect(lastPaymentMethodBlockers({ ...METHODS[m], acceptMenuOrders: menu, drops: DROPS[d] }, NOW)).toEqual(
      expected,
    );
  });

  it("a mix of drops blocks when any one of them still takes orders", () => {
    expect(
      lastPaymentMethodBlockers(
        { ...METHODS.none, acceptMenuOrders: false, drops: [...DROPS.closed, ...DROPS.scheduled] },
        NOW,
      ),
    ).toEqual(["open_drop"]);
  });
});
