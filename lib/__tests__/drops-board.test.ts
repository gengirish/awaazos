import type { DropStatus, FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  boardBucket,
  boardPollKind,
  checkOrderAction,
  countByFilter,
  filterOrders,
  firstName,
  groupByFulfilment,
  groupIdsByDrop,
  handoverDue,
  isDropFrozen,
  liveEffectiveStatus,
  newOrderIds,
  orderActionBase,
  ordersInScope,
  ordersToPack,
  prepFromOrders,
  shouldPollForOrders,
  summarizeOrders,
  whatsappHref,
} from "@/lib/drops-board";
import { effectiveDropStatus, type OrderDisplayState } from "@/lib/drops";

const NOW = new Date("2026-10-05T10:00:00.000Z");

describe("boardBucket", () => {
  const cases: [OrderDisplayState, FulfilmentStatus | null, string][] = [
    ["AWAITING_PAYMENT", "PLACED", "needs_action"],
    ["PAYMENT_SUBMITTED", "PLACED", "needs_action"],
    ["PAYMENT_SUBMITTED", "CONFIRMED", "needs_action"], // still has to tick "paid"
    ["AWAITING_PAYMENT", "CONFIRMED", "needs_action"],
    ["PAY_ON_DELIVERY", "PLACED", "needs_action"],
    ["PAID", "PLACED", "needs_action"],
    ["PAY_ON_DELIVERY", "CONFIRMED", "confirmed"],
    ["PAID", "CONFIRMED", "confirmed"],
    ["DELIVERED", "DELIVERED", "delivered"],
    ["CANCELLED", "CANCELLED", "closed"],
    ["EXPIRED", "PLACED", "closed"],
  ];
  it.each(cases)("%s + %s → %s", (displayState, fulfilmentStatus, bucket) => {
    expect(boardBucket({ displayState, fulfilmentStatus })).toBe(bucket);
  });

  it("filters and counts", () => {
    const orders = [
      { id: "a", bucket: "needs_action" as const },
      { id: "b", bucket: "confirmed" as const },
      { id: "c", bucket: "needs_action" as const },
    ];
    expect(filterOrders(orders, "needs_action").map((o) => o.id)).toEqual(["a", "c"]);
    expect(filterOrders(orders, "all")).toHaveLength(3);
    expect(countByFilter(orders)).toEqual({ needs_action: 2, confirmed: 1, delivered: 0, closed: 0, all: 3 });
  });
});

describe("summarizeOrders", () => {
  it("splits paid vs pending and ignores cancelled / expired", () => {
    const s = summarizeOrders([
      { displayState: "PAID", paymentStatus: "PAID", totalPaise: 25_000 },
      { displayState: "DELIVERED", paymentStatus: "PAID", totalPaise: 10_000 },
      { displayState: "PAY_ON_DELIVERY", paymentStatus: "PENDING", totalPaise: 15_000 },
      { displayState: "PAYMENT_SUBMITTED", paymentStatus: "PENDING", totalPaise: 5_000 },
      { displayState: "CANCELLED", paymentStatus: "REFUNDED", totalPaise: 99_900 },
      { displayState: "EXPIRED", paymentStatus: "PENDING", totalPaise: 12_300 },
    ]);
    expect(s.paidPaise).toBe(35_000);
    expect(s.pendingPaise).toBe(20_000);
    expect(s.activeOrders).toBe(4);
    expect(s.counts.CANCELLED).toBe(1);
    expect(s.counts.EXPIRED).toBe(1);
    expect(s.counts.AWAITING_PAYMENT).toBe(0);
    expect(Number.isInteger(s.paidPaise) && Number.isInteger(s.pendingPaise)).toBe(true);
  });
});

describe("prepFromOrders", () => {
  const items = [
    { id: "laddu", name: "Besan laddu", emoji: null, maxQty: 10 },
    { id: "cake", name: "Eggless cake", emoji: null, maxQty: null },
    { id: "chakli", name: "Chakli", emoji: null, maxQty: 5 },
  ];

  it("sums only holding, non-cancelled orders; skips orphaned lines", () => {
    const rows = prepFromOrders(items, [
      { holdsStock: true, displayState: "PAID", items: [{ dropItemId: "laddu", qty: 4 }, { dropItemId: "cake", qty: 1 }] },
      { holdsStock: true, displayState: "PAY_ON_DELIVERY", items: [{ dropItemId: "laddu", qty: 3 }] },
      { holdsStock: false, displayState: "EXPIRED", items: [{ dropItemId: "laddu", qty: 9 }] },
      { holdsStock: false, displayState: "CANCELLED", items: [{ dropItemId: "cake", qty: 2 }] },
      { holdsStock: true, displayState: "PAID", items: [{ dropItemId: null, qty: 7 }] },
    ]);
    expect(rows).toEqual([
      { dropItemId: "laddu", name: "Besan laddu", emoji: null, qtyOrdered: 7, maxQty: 10, remaining: 3 },
      { dropItemId: "cake", name: "Eggless cake", emoji: null, qtyOrdered: 1, maxQty: null, remaining: null },
      { dropItemId: "chakli", name: "Chakli", emoji: null, qtyOrdered: 0, maxQty: 5, remaining: 5 },
    ]);
  });

  it("never reports negative remaining when capacity was lowered below sold", () => {
    const [row] = prepFromOrders([items[2]!], [
      { holdsStock: true, displayState: "PAID", items: [{ dropItemId: "chakli", qty: 8 }] },
    ]);
    expect(row!.remaining).toBe(0);
  });

  it("ordersToPack keeps holding, non-cancelled orders", () => {
    const out = ordersToPack([
      { id: "a", holdsStock: true, displayState: "PAID" as const },
      { id: "b", holdsStock: false, displayState: "EXPIRED" as const },
      { id: "c", holdsStock: false, displayState: "CANCELLED" as const },
      { id: "d", holdsStock: true, displayState: "DELIVERED" as const },
    ]);
    expect(out.map((o) => o.id)).toEqual(["a", "d"]);
  });
});

describe("handover", () => {
  const due = (paymentStatus: PaymentStatus, paymentMethod: PaymentMethod) =>
    handoverDue({ paymentStatus, paymentMethod, totalPaise: 34_500 });

  it("paid / collect cash / unpaid upi", () => {
    expect(due("PAID", "UPI")).toEqual({ kind: "paid" });
    expect(due("PAID", "CASH")).toEqual({ kind: "paid" });
    expect(due("PENDING", "CASH")).toEqual({ kind: "collect_cash", amountPaise: 34_500 });
    expect(due("PENDING", "UPI")).toEqual({ kind: "unpaid_upi", amountPaise: 34_500 });
  });

  it("groups by fulfilment type (null → delivery)", () => {
    const g = groupByFulfilment([
      { id: 1, fulfilmentType: "PICKUP" as const },
      { id: 2, fulfilmentType: "DELIVERY" as const },
      { id: 3, fulfilmentType: null },
    ]);
    expect(g.pickup.map((o) => o.id)).toEqual([1]);
    expect(g.delivery.map((o) => o.id)).toEqual([2, 3]);
  });
});

describe("checkOrderAction", () => {
  const o = (fulfilmentStatus: FulfilmentStatus, paymentStatus: PaymentStatus = "PENDING") => ({
    fulfilmentStatus,
    paymentStatus,
  });

  it("allows the happy-path transitions on an open drop", () => {
    expect(checkOrderAction("confirm", "OPEN", o("PLACED"))).toEqual({ ok: true });
    expect(checkOrderAction("mark_paid", "OPEN", o("CONFIRMED"))).toEqual({ ok: true });
    expect(checkOrderAction("deliver", "CLOSED", o("PLACED"))).toEqual({ ok: true });
    expect(checkOrderAction("deliver", "CLOSED", o("CONFIRMED"))).toEqual({ ok: true });
    expect(checkOrderAction("undeliver", "CLOSED", o("DELIVERED"))).toEqual({ ok: true });
    expect(checkOrderAction("cancel", "OPEN", o("CONFIRMED", "PAID"))).toEqual({ ok: true });
  });

  it("rejects invalid states with invalid_state", () => {
    const bad = { ok: false, error: "invalid_state" };
    expect(checkOrderAction("confirm", "OPEN", o("CONFIRMED"))).toEqual(bad);
    expect(checkOrderAction("mark_paid", "OPEN", o("CONFIRMED", "PAID"))).toEqual(bad);
    expect(checkOrderAction("mark_paid", "OPEN", o("CANCELLED"))).toEqual(bad);
    expect(checkOrderAction("cancel", "OPEN", o("DELIVERED"))).toEqual(bad);
    expect(checkOrderAction("cancel", "OPEN", o("CANCELLED"))).toEqual(bad);
    expect(checkOrderAction("deliver", "OPEN", o("DELIVERED"))).toEqual(bad);
    expect(checkOrderAction("undeliver", "OPEN", o("CONFIRMED"))).toEqual(bad);
  });

  it.each<DropStatus>(["FROZEN", "FULFILLED"])("%s drop locks confirm and cancel only", (status) => {
    const frozen = { ok: false, error: "drop_frozen" };
    expect(checkOrderAction("confirm", status, o("PLACED"))).toEqual(frozen);
    expect(checkOrderAction("cancel", status, o("CONFIRMED"))).toEqual(frozen);
    expect(checkOrderAction("mark_paid", status, o("CONFIRMED"))).toEqual({ ok: true });
    expect(checkOrderAction("deliver", status, o("CONFIRMED"))).toEqual({ ok: true });
    expect(checkOrderAction("undeliver", status, o("DELIVERED"))).toEqual({ ok: true });
  });
});

describe("liveEffectiveStatus parity with effectiveDropStatus", () => {
  const closesAt = new Date("2026-10-05T15:30:00.000Z");
  const opensAt = new Date("2026-10-04T03:30:00.000Z");
  const statuses: DropStatus[] = ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"];
  const times = [
    new Date("2026-10-04T00:00:00.000Z"), // before open
    opensAt,
    NOW,
    closesAt, // exactly at cut-off
    new Date("2026-10-06T00:00:00.000Z"),
  ];
  for (const status of statuses) {
    for (const opens of [null, opensAt]) {
      for (const t of times) {
        it(`${status} opens=${opens ? "set" : "null"} at ${t.toISOString()}`, () => {
          const expected = effectiveDropStatus({ status, opensAt: opens, closesAt }, t);
          expect(liveEffectiveStatus({ status, opensAt: opens, closesAt }, t)).toBe(expected);
          expect(
            liveEffectiveStatus(
              { status, opensAt: opens?.toISOString() ?? null, closesAt: closesAt.toISOString() },
              t,
            ),
          ).toBe(expected);
        });
      }
    }
  }

  it("polls only while OPEN or SCHEDULED", () => {
    expect(shouldPollForOrders("OPEN")).toBe(true);
    expect(shouldPollForOrders("SCHEDULED")).toBe(true);
    for (const s of ["DRAFT", "CLOSED", "FROZEN", "FULFILLED"] as const) {
      expect(shouldPollForOrders(s)).toBe(false);
    }
  });
});

describe("display helpers", () => {
  it("firstName", () => {
    expect(firstName("  Priya   Sharma ")).toBe("Priya");
    expect(firstName("")).toBe("a customer");
    expect(firstName(null)).toBe("a customer");
  });

  it("whatsappHref strips non-digits and encodes text", () => {
    expect(whatsappHref("+91 98765-43210")).toBe("https://wa.me/919876543210");
    expect(whatsappHref("+919876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });

  it("newOrderIds", () => {
    expect(newOrderIds([{ id: "a" }, { id: "b" }], [{ id: "c" }, { id: "a" }, { id: "b" }])).toEqual(["c"]);
    expect(newOrderIds([{ id: "a" }], [{ id: "a" }])).toEqual([]);
  });
});

describe("one board for menu and drop orders", () => {
  const orders = [
    { id: "m1", dropId: null },
    { id: "a1", dropId: "dropA" },
    { id: "m2", dropId: null },
    { id: "b1", dropId: "dropB" },
    { id: "a2", dropId: "dropA" },
  ];

  it("ordersInScope: everything, only menu orders, or one drop", () => {
    expect(ordersInScope(orders, "all")).toBe(orders);
    expect(ordersInScope(orders, "menu").map((o) => o.id)).toEqual(["m1", "m2"]);
    expect(ordersInScope(orders, "dropA").map((o) => o.id)).toEqual(["a1", "a2"]);
    expect(ordersInScope(orders, "no-such-drop")).toEqual([]);
  });

  it("orderActionBase: each order goes to its own route family", () => {
    expect(orderActionBase(null)).toBe("/api/storefront-orders");
    expect(orderActionBase("dropA")).toBe("/api/drops/dropA/orders");
    expect(orderActionBase("a/b")).toBe("/api/drops/a%2Fb/orders");
  });

  it("groupIdsByDrop: one group per drop plus one for menu orders, board order kept", () => {
    expect(groupIdsByDrop(orders)).toEqual([
      { dropId: null, ids: ["m1", "m2"] },
      { dropId: "dropA", ids: ["a1", "a2"] },
      { dropId: "dropB", ids: ["b1"] },
    ]);
    expect(groupIdsByDrop([])).toEqual([]);
  });

  it("isDropFrozen: only the stored FROZEN / FULFILLED states lock a drop's orders", () => {
    const frozen: DropStatus[] = ["FROZEN", "FULFILLED"];
    for (const s of ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"] as DropStatus[]) {
      expect(isDropFrozen(s)).toBe(frozen.includes(s));
    }
  });
});

describe("boardPollKind", () => {
  it("never polls when nothing can take an order", () => {
    for (const signalMode of ["kv", "fallback"] as const) {
      expect(boardPollKind({ acceptMenuOrders: false, dropStatuses: [], signalMode })).toBeNull();
      expect(
        boardPollKind({ acceptMenuOrders: false, dropStatuses: ["DRAFT", "CLOSED", "FROZEN", "FULFILLED"], signalMode }),
      ).toBeNull();
    }
  });

  it("order from menu on: polls the KV signal when available, else falls back", () => {
    expect(boardPollKind({ acceptMenuOrders: true, dropStatuses: [], signalMode: "kv" })).toBe("signal");
    expect(boardPollKind({ acceptMenuOrders: true, dropStatuses: ["CLOSED"], signalMode: "fallback" })).toBe("fallback");
  });

  it("one open drop among closed ones is enough", () => {
    expect(boardPollKind({ acceptMenuOrders: false, dropStatuses: ["FULFILLED", "OPEN"], signalMode: "kv" })).toBe("signal");
    expect(boardPollKind({ acceptMenuOrders: false, dropStatuses: ["FULFILLED", "OPEN"], signalMode: "fallback" })).toBe(
      "fallback",
    );
  });

  it("a drop that only opens later polls the cheap signal, never Postgres directly", () => {
    expect(boardPollKind({ acceptMenuOrders: false, dropStatuses: ["SCHEDULED"], signalMode: "kv" })).toBe("signal");
    expect(boardPollKind({ acceptMenuOrders: false, dropStatuses: ["SCHEDULED"], signalMode: "fallback" })).toBeNull();
  });
});
