import { describe, expect, it, vi } from "vitest";

// Pure functions only — keep Prisma/env/KV out of the unit run.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpOrderSignal: vi.fn() }));

import type { DropStatus, FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";

import {
  PENDING_HOLD_MINUTES,
  allowedFulfilmentTypes,
  canTransition,
  computeOrderTotals,
  effectiveDropStatus,
  isAcceptingOrders,
  mergeOrderLines,
  orderDisplayState,
  orderHoldsStock,
  remainingQty,
  stockHoldingOrderWhere,
  type EffectiveDropStatus,
} from "@/lib/drops";

const T0 = new Date("2026-10-09T15:30:00.000Z"); // Fri 9:00 pm IST
const MIN = 60_000;

describe("effectiveDropStatus", () => {
  const opensAt = new Date(T0.getTime() - 24 * 60 * MIN);
  const closesAt = T0;
  const drop = (status: DropStatus, o: Date | null = opensAt) => ({ status, opensAt: o, closesAt });

  it("is SCHEDULED before opensAt", () => {
    expect(effectiveDropStatus(drop("OPEN"), new Date(opensAt.getTime() - 1))).toBe("SCHEDULED");
    expect(isAcceptingOrders(drop("OPEN"), new Date(opensAt.getTime() - 1))).toBe(false);
  });

  it("is OPEN exactly at opensAt and up to just before closesAt", () => {
    expect(effectiveDropStatus(drop("OPEN"), opensAt)).toBe("OPEN");
    expect(effectiveDropStatus(drop("OPEN"), new Date(closesAt.getTime() - 1))).toBe("OPEN");
    expect(isAcceptingOrders(drop("OPEN"), new Date(closesAt.getTime() - 1))).toBe(true);
  });

  it("is CLOSED exactly at closesAt (cut-off is exclusive)", () => {
    expect(effectiveDropStatus(drop("OPEN"), closesAt)).toBe("CLOSED");
    expect(isAcceptingOrders(drop("OPEN"), closesAt)).toBe(false);
  });

  it("null opensAt means open as soon as published", () => {
    expect(effectiveDropStatus(drop("OPEN", null), new Date(0))).toBe("OPEN");
  });

  it("regression: a Saturday drop with a Friday 21:00 IST cut-off is OPEN on Thursday night", () => {
    // Sat 10 Oct 2026 drop; cut-off Fri 9 Oct 21:00 IST = 15:30Z.
    const saturdayDrop = { status: "OPEN" as DropStatus, opensAt: null, closesAt: new Date("2026-10-09T15:30:00.000Z") };
    const thursday10pmIst = new Date("2026-10-08T16:30:00.000Z");
    expect(effectiveDropStatus(saturdayDrop, thursday10pmIst)).toBe("OPEN");
    expect(isAcceptingOrders(saturdayDrop, thursday10pmIst)).toBe(true);
  });

  it.each<DropStatus>(["DRAFT", "CLOSED", "FROZEN", "FULFILLED"])("%s passes through regardless of time", (s) => {
    expect(effectiveDropStatus(drop(s), new Date(opensAt.getTime() - MIN))).toBe(s);
    expect(effectiveDropStatus(drop(s), new Date(closesAt.getTime() + MIN))).toBe(s);
    expect(effectiveDropStatus(drop(s), new Date(closesAt.getTime() - MIN))).toBe(s);
  });
});

describe("canTransition", () => {
  const all: DropStatus[] = ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"];
  const allowed: Record<EffectiveDropStatus, DropStatus[]> = {
    DRAFT: ["OPEN"],
    OPEN: ["CLOSED", "FROZEN", "DRAFT"],
    SCHEDULED: ["CLOSED", "FROZEN", "DRAFT"], // a scheduled drop is stored OPEN
    CLOSED: ["OPEN", "FROZEN"],
    FROZEN: ["FULFILLED", "CLOSED"],
    FULFILLED: [],
  };

  for (const from of Object.keys(allowed) as EffectiveDropStatus[]) {
    for (const to of all) {
      const expected = allowed[from].includes(to);
      it(`${from} → ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it("an OPEN drop past its cut-off behaves as CLOSED", () => {
    const d = { status: "OPEN" as const, opensAt: null, closesAt: T0 };
    const eff = effectiveDropStatus(d, new Date(T0.getTime() + MIN));
    expect(eff).toBe("CLOSED");
    expect(canTransition(eff, "OPEN")).toBe(true); // reopen (caller moves closesAt)
    expect(canTransition(eff, "FROZEN")).toBe(true);
    expect(canTransition(eff, "DRAFT")).toBe(false); // can't un-publish once orders could exist
  });
});

describe("allowedFulfilmentTypes", () => {
  it("maps modes to buyer choices", () => {
    expect(allowedFulfilmentTypes("BOTH")).toEqual(["DELIVERY", "PICKUP"]);
    expect(allowedFulfilmentTypes("PICKUP")).toEqual(["PICKUP"]);
    expect(allowedFulfilmentTypes("DELIVERY")).toEqual(["DELIVERY"]);
  });
});

type Hold = {
  fulfilmentStatus: FulfilmentStatus | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  upiRef: string | null;
  paymentClaimedAt: Date | null;
  createdAt: Date;
};

const pending = (over: Partial<Hold> = {}): Hold => ({
  fulfilmentStatus: "PLACED",
  paymentStatus: "PENDING",
  paymentMethod: "UPI",
  upiRef: null,
  paymentClaimedAt: null,
  createdAt: T0,
  ...over,
});

const holdMs = PENDING_HOLD_MINUTES * MIN;

describe("orderHoldsStock / orderDisplayState", () => {
  it("hold window is 15 minutes", () => {
    expect(PENDING_HOLD_MINUTES).toBe(15);
  });

  const cases: { name: string; o: Hold; at: Date; holds: boolean; state: string }[] = [
    { name: "fresh unpaid UPI", o: pending(), at: T0, holds: true, state: "AWAITING_PAYMENT" },
    {
      name: "unpaid UPI 1ms before hold expiry",
      o: pending(),
      at: new Date(T0.getTime() + holdMs - 1),
      holds: true,
      state: "AWAITING_PAYMENT",
    },
    {
      name: "unpaid UPI exactly at 15 min",
      o: pending(),
      at: new Date(T0.getTime() + holdMs),
      holds: false,
      state: "EXPIRED",
    },
    {
      name: "unpaid UPI long expired",
      o: pending(),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: false,
      state: "EXPIRED",
    },
    {
      name: "paid, old",
      o: pending({ paymentStatus: "PAID" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "PAID",
    },
    {
      name: "cash on delivery, old",
      o: pending({ paymentMethod: "CASH" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "PAY_ON_DELIVERY",
    },
    {
      name: "UTR submitted, old",
      o: pending({ upiRef: "123456789012" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "PAYMENT_SUBMITTED",
    },
    {
      name: "buyer tapped I've paid without a UTR, old",
      o: pending({ paymentClaimedAt: T0 }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "PAYMENT_SUBMITTED",
    },
    {
      name: "claim cleared by Not received, past the hold window",
      o: pending({ paymentClaimedAt: null, upiRef: null }),
      at: new Date(T0.getTime() + holdMs),
      holds: false,
      state: "EXPIRED",
    },
    {
      name: "claimed, then paid",
      o: pending({ paymentClaimedAt: T0, paymentStatus: "PAID" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "PAID",
    },
    {
      name: "claimed, then cancelled",
      o: pending({ paymentClaimedAt: T0, fulfilmentStatus: "CANCELLED" }),
      at: T0,
      holds: false,
      state: "CANCELLED",
    },
    {
      name: "confirmed by vendor, unpaid, old",
      o: pending({ fulfilmentStatus: "CONFIRMED" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "AWAITING_PAYMENT", // vendor confirmed it, so it never silently expires
    },
    {
      name: "delivered",
      o: pending({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "DELIVERED",
    },
    {
      name: "delivered, unpaid",
      o: pending({ fulfilmentStatus: "DELIVERED" }),
      at: new Date(T0.getTime() + 24 * 60 * MIN),
      holds: true,
      state: "DELIVERED",
    },
    { name: "cancelled fresh", o: pending({ fulfilmentStatus: "CANCELLED" }), at: T0, holds: false, state: "CANCELLED" },
    {
      name: "cancelled after paying (refunded)",
      o: pending({ fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED" }),
      at: T0,
      holds: false,
      state: "CANCELLED",
    },
    {
      name: "cancelled although marked PAID",
      o: pending({ fulfilmentStatus: "CANCELLED", paymentStatus: "PAID" }),
      at: T0,
      holds: false,
      state: "CANCELLED",
    },
  ];

  it.each(cases)("$name", ({ o, at, holds, state }) => {
    expect(orderHoldsStock(o, at)).toBe(holds);
    expect(orderDisplayState(o, at)).toBe(state);
  });

  it("AWAITING_PAYMENT ⇔ unpaid UPI order that still holds stock", () => {
    for (const c of cases) {
      if (orderDisplayState(c.o, c.at) === "AWAITING_PAYMENT") expect(orderHoldsStock(c.o, c.at)).toBe(true);
      if (orderDisplayState(c.o, c.at) === "CANCELLED") expect(orderHoldsStock(c.o, c.at)).toBe(false);
    }
  });

  it("stockHoldingOrderWhere uses the same 15-min cutoff", () => {
    const w = stockHoldingOrderWhere(T0);
    const created = (w.OR as Array<Record<string, unknown>>).find((c) => "createdAt" in c) as {
      createdAt: { gt: Date };
    };
    expect(created.createdAt.gt.getTime()).toBe(T0.getTime() - holdMs);
    expect(w.fulfilmentStatus).toEqual({ not: "CANCELLED" });
  });
});

describe("remainingQty", () => {
  it("null maxQty is unlimited", () => {
    expect(remainingQty(null, 0)).toBeNull();
    expect(remainingQty(null, 999)).toBeNull();
  });
  it("subtracts sold", () => {
    expect(remainingQty(5, 0)).toBe(5);
    expect(remainingQty(5, 3)).toBe(2);
    expect(remainingQty(5, 5)).toBe(0);
  });
  it("clamps at zero when the vendor lowers maxQty below sold", () => {
    expect(remainingQty(3, 7)).toBe(0);
  });
});

describe("computeOrderTotals", () => {
  it("sums integer paise and adds the delivery fee", () => {
    const r = computeOrderTotals(
      [
        { priceInPaise: 4550, qty: 2 },
        { priceInPaise: 1999, qty: 3 },
      ],
      3000,
    );
    expect(r).toEqual({ subtotalPaise: 9100 + 5997, totalPaise: 9100 + 5997 + 3000 });
    expect(Number.isInteger(r.subtotalPaise)).toBe(true);
    expect(Number.isInteger(r.totalPaise)).toBe(true);
  });
  it("no lines → zero subtotal", () => {
    expect(computeOrderTotals([], 0)).toEqual({ subtotalPaise: 0, totalPaise: 0 });
  });
  it("avoids float drift (10 × ₹0.10 is exactly ₹1)", () => {
    expect(computeOrderTotals([{ priceInPaise: 10, qty: 10 }], 0).subtotalPaise).toBe(100);
  });
});

describe("mergeOrderLines", () => {
  it("merges duplicate drop items and keeps first-seen order", () => {
    expect(
      mergeOrderLines([
        { dropItemId: "a", qty: 2 },
        { dropItemId: "b", qty: 1 },
        { dropItemId: "a", qty: 3 },
      ]),
    ).toEqual([
      { dropItemId: "a", qty: 5 },
      { dropItemId: "b", qty: 1 },
    ]);
  });
  it("empty in, empty out", () => {
    expect(mergeOrderLines([])).toEqual([]);
  });
});
