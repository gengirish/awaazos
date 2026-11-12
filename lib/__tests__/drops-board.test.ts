import type { DropStatus, FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  BOARD_FILTERS,
  availableOrderActions,
  boardBucket,
  boardPollKind,
  checkOrderAction,
  countByFilter,
  filterByHandover,
  filterOrders,
  firstName,
  groupByFulfilment,
  groupIdsByDrop,
  handoverDue,
  isDropFrozen,
  liveEffectiveStatus,
  markPaidNeedsConfirm,
  newOrderIds,
  newOrdersTab,
  orderActionBase,
  ordersInScope,
  ordersToPack,
  prepFromOrders,
  primaryOrderAction,
  searchOrders,
  shouldPollForOrders,
  orderStateLabel,
  paymentBadge,
  type BoardBucket,
  summarizeOrders,
  whatsappHref,
} from "@/lib/drops-board";
import { effectiveDropStatus, type OrderDisplayState } from "@/lib/drops";

const NOW = new Date("2026-10-05T10:00:00.000Z");

describe("boardBucket (the stage tabs)", () => {
  const cases: [OrderDisplayState, FulfilmentStatus | null, string][] = [
    ["AWAITING_PAYMENT", "PLACED", "new"],
    ["PAYMENT_SUBMITTED", "PLACED", "new"],
    ["PAYMENT_SUBMITTED", "CONFIRMED", "new"], // the buyer's claim still waits for an answer
    ["AWAITING_PAYMENT", "CONFIRMED", "preparing"], // payment is a badge, not a stage
    ["PAY_ON_DELIVERY", "PLACED", "new"],
    ["PAID", "PLACED", "new"],
    ["PAY_ON_DELIVERY", "CONFIRMED", "preparing"],
    ["PAID", "CONFIRMED", "preparing"],
    ["DELIVERED", "DELIVERED", "done"],
    ["CANCELLED", "CANCELLED", "done"],
    ["EXPIRED", "PLACED", "done"],
  ];
  it.each(cases)("%s + %s → %s", (displayState, fulfilmentStatus, bucket) => {
    expect(boardBucket({ displayState, fulfilmentStatus })).toBe(bucket);
  });

  it("is Ready once packed for pickup or out for delivery", () => {
    const at = "2026-10-05T09:00:00.000Z";
    expect(boardBucket({ displayState: "PAID", fulfilmentStatus: "CONFIRMED", readyAt: at })).toBe("ready");
    expect(boardBucket({ displayState: "PAY_ON_DELIVERY", fulfilmentStatus: "CONFIRMED", outForDeliveryAt: at })).toBe(
      "ready",
    );
    // An unanswered claim is still New, ready or not; a handed-over order is Done.
    expect(boardBucket({ displayState: "PAYMENT_SUBMITTED", fulfilmentStatus: "CONFIRMED", readyAt: at })).toBe("new");
    expect(boardBucket({ displayState: "DELIVERED", fulfilmentStatus: "DELIVERED", readyAt: at })).toBe("done");
  });

  it("has four tabs, and filters and counts by them", () => {
    expect(BOARD_FILTERS.map((f) => f.label)).toEqual(["New", "Preparing", "Ready", "Done"]);
    const orders = [
      { id: "a", bucket: "new" as const },
      { id: "b", bucket: "preparing" as const },
      { id: "c", bucket: "new" as const },
      { id: "d", bucket: "ready" as const },
    ];
    expect(filterOrders(orders, "new").map((o) => o.id)).toEqual(["a", "c"]);
    expect(filterOrders(orders, "ready").map((o) => o.id)).toEqual(["d"]);
    expect(countByFilter(orders)).toEqual({ new: 2, preparing: 1, ready: 1, done: 0 });
  });
});

describe("a Razorpay store's unpaid new order (awaiting_online)", () => {
  const order = {
    fulfilmentStatus: "PLACED" as const,
    paymentStatus: "PENDING" as const,
    paymentMethod: "UPI" as const,
    fulfilmentType: "DELIVERY" as const,
    displayState: "AWAITING_PAYMENT" as const,
    bucket: "awaiting_online" as const,
  };

  it("only a new, unpaid order on an online store", () => {
    const bucket = (displayState: OrderDisplayState, fulfilmentStatus: FulfilmentStatus, onlineStore = true) =>
      boardBucket({ displayState, fulfilmentStatus, onlineStore });
    expect(bucket("AWAITING_PAYMENT", "PLACED")).toBe("awaiting_online");
    expect(bucket("AWAITING_PAYMENT", "PLACED", false)).toBe("new");
    // The seller accepted it: it holds stock until they answer, so it must stay reachable.
    expect(bucket("AWAITING_PAYMENT", "CONFIRMED")).toBe("preparing");
    // A claim or a lapsed hold: money may have come by direct UPI, so the seller can still mark it paid.
    expect(bucket("PAYMENT_SUBMITTED", "PLACED")).toBe("new");
    expect(bucket("EXPIRED", "PLACED")).toBe("done");
    expect(bucket("PAY_ON_DELIVERY", "PLACED")).toBe("new");
    expect(bucket("PAID", "CONFIRMED")).toBe("preparing");
  });

  it("has no tab or count of its own: it is listed last under New", () => {
    const orders = [{ id: "a", bucket: "awaiting_online" as const }, { id: "b", bucket: "new" as const }];
    expect(BOARD_FILTERS.map((f) => f.id)).not.toContain("awaiting_online");
    expect(filterOrders(orders, "new").map((o) => o.id)).toEqual(["b", "a"]);
    expect(filterOrders(orders, "preparing")).toEqual([]);
    expect(countByFilter(orders)).toEqual({ new: 1, preparing: 0, ready: 0, done: 0 });
  });

  it("isn't in the summary", () => {
    const s = summarizeOrders([
      { displayState: "AWAITING_PAYMENT", paymentStatus: "PENDING", totalPaise: 12_000, bucket: "awaiting_online" },
      { displayState: "AWAITING_PAYMENT", paymentStatus: "PENDING", totalPaise: 5_000, bucket: "new" },
    ]);
    expect(s.pendingPaise).toBe(5_000);
    expect(s.activeOrders).toBe(1);
    expect(s.counts.AWAITING_PAYMENT).toBe(1);
  });

  it("offers only Cancel, with no next step, and nothing on a frozen drop", () => {
    expect(Array.from(availableOrderActions(order, false))).toEqual(["cancel"]);
    expect(Array.from(availableOrderActions(order, true))).toEqual([]);
    expect(primaryOrderAction(order, false)).toBeNull();
  });

  it("the server refuses everything else, so a stale board can't hold its stock", () => {
    const o = { fulfilmentStatus: "PLACED" as const, paymentStatus: "PENDING" as const, fulfilmentType: "DELIVERY" as const };
    for (const action of ["confirm", "mark_paid", "reject_payment", "dispatch", "deliver", "undeliver"] as const) {
      expect(checkOrderAction(action, "OPEN", { ...o, awaitingOnlinePay: true })).toEqual({ ok: false, error: "invalid_state" });
    }
    expect(checkOrderAction("cancel", "OPEN", { ...o, awaitingOnlinePay: true })).toEqual({ ok: true });
    expect(checkOrderAction("confirm", "OPEN", o)).toEqual({ ok: true });
  });

  it("arrives when it moves on, not when it is placed or lapses", () => {
    const row = (id: string, bucket: BoardBucket) => ({ id, bucket });
    expect(newOrderIds([], [row("a", "awaiting_online")])).toEqual([]);
    expect(newOrderIds([row("a", "awaiting_online")], [row("a", "awaiting_online")])).toEqual([]);
    expect(newOrderIds([row("a", "awaiting_online")], [row("a", "preparing")])).toEqual(["a"]);
    expect(newOrderIds([row("a", "awaiting_online")], [row("a", "new")])).toEqual(["a"]);
    expect(newOrderIds([row("a", "awaiting_online")], [row("a", "done")])).toEqual([]);
    // Paid before the board ever saw it.
    expect(newOrderIds([], [row("a", "preparing")])).toEqual(["a"]);
    // An order already on the board moving tabs is not new.
    expect(newOrderIds([row("a", "new")], [row("a", "preparing")])).toEqual([]);
  });

  it("\"N new orders — show\" lands where the new orders are", () => {
    expect(newOrdersTab([{ bucket: "preparing" }])).toBe("preparing");
    expect(newOrdersTab([{ bucket: "preparing" }, { bucket: "new" }])).toBe("new");
    expect(newOrdersTab([{ bucket: "new" }])).toBe("new");
    expect(newOrdersTab([])).toBe("new");
  });
});

describe("summarizeOrders", () => {
  it("splits paid vs pending, ignores cancelled / expired, and counts only unfinished orders as live", () => {
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
    expect(s.activeOrders).toBe(3); // the delivered one is done
    expect(s.counts.CANCELLED).toBe(1);
    expect(s.counts.EXPIRED).toBe(1);
    expect(s.counts.AWAITING_PAYMENT).toBe(0);
    expect(Number.isInteger(s.paidPaise) && Number.isInteger(s.pendingPaise)).toBe(true);
  });
});

describe("orderStateLabel", () => {
  it("says Picked up for a handed-over pickup order, Delivered otherwise", () => {
    expect(orderStateLabel({ displayState: "DELIVERED", fulfilmentType: "PICKUP" })).toBe("Picked up");
    expect(orderStateLabel({ displayState: "DELIVERED", fulfilmentType: "DELIVERY" })).toBe("Delivered");
    expect(orderStateLabel({ displayState: "DELIVERED", fulfilmentType: null })).toBe("Delivered");
    expect(orderStateLabel({ displayState: "PAID", fulfilmentType: "PICKUP" })).toBe("Paid");
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
      { dropItemId: "laddu", name: "Besan laddu", emoji: null, qtyOrdered: 7, qtyFree: 0, maxQty: 10, remaining: 3 },
      { dropItemId: "cake", name: "Eggless cake", emoji: null, qtyOrdered: 1, qtyFree: 0, maxQty: null, remaining: null },
      { dropItemId: "chakli", name: "Chakli", emoji: null, qtyOrdered: 0, qtyFree: 0, maxQty: 5, remaining: 5 },
    ]);
  });

  it("counts a free gift in the item's total and in qtyFree", () => {
    const [laddu] = prepFromOrders([items[0]!], [
      {
        holdsStock: true,
        displayState: "PAID",
        items: [
          { dropItemId: "laddu", qty: 3 },
          { dropItemId: "laddu", qty: 1, isGift: true },
        ],
      },
      { holdsStock: false, displayState: "CANCELLED", items: [{ dropItemId: "laddu", qty: 1, isGift: true }] },
    ]);
    expect(laddu).toMatchObject({ qtyOrdered: 4, qtyFree: 1, remaining: 6 });
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
    expect(checkOrderAction("dispatch", status, { ...o("CONFIRMED"), fulfilmentType: "DELIVERY" })).toEqual({
      ok: true,
    });
  });

  it("dispatch is for live delivery orders only", () => {
    const delivery = (fs: FulfilmentStatus) => ({ ...o(fs), fulfilmentType: "DELIVERY" as const });
    const bad = { ok: false, error: "invalid_state" };
    expect(checkOrderAction("dispatch", null, delivery("PLACED"))).toEqual({ ok: true });
    expect(checkOrderAction("dispatch", null, delivery("CONFIRMED"))).toEqual({ ok: true });
    expect(checkOrderAction("dispatch", null, delivery("DELIVERED"))).toEqual(bad);
    expect(checkOrderAction("dispatch", null, delivery("CANCELLED"))).toEqual(bad);
    expect(checkOrderAction("dispatch", null, { ...o("CONFIRMED"), fulfilmentType: "PICKUP" })).toEqual(bad);
    expect(checkOrderAction("dispatch", null, o("CONFIRMED"))).toEqual(bad);
  });
});

describe("availableOrderActions: out for delivery", () => {
  const card = (over: Partial<Parameters<typeof availableOrderActions>[0]> = {}) => ({
    fulfilmentStatus: "CONFIRMED" as FulfilmentStatus,
    paymentStatus: "PENDING" as PaymentStatus,
    paymentMethod: "CASH" as PaymentMethod,
    fulfilmentType: "DELIVERY" as const,
    outForDeliveryAt: null,
    ...over,
  });

  it("offers it on a live delivery order that has not gone out", () => {
    expect(availableOrderActions(card(), false).has("dispatch")).toBe(true);
    expect(availableOrderActions(card({ fulfilmentStatus: "PLACED" }), true).has("dispatch")).toBe(true);
  });

  it("not once it has gone out, nor for pickups or finished orders", () => {
    expect(availableOrderActions(card({ outForDeliveryAt: "2026-10-16T10:00:00.000Z" }), false).has("dispatch")).toBe(
      false,
    );
    expect(availableOrderActions(card({ fulfilmentType: "PICKUP" }), false).has("dispatch")).toBe(false);
    expect(availableOrderActions(card({ fulfilmentStatus: "DELIVERED" }), false).has("dispatch")).toBe(false);
    expect(availableOrderActions(card({ fulfilmentStatus: "CANCELLED" }), false).has("dispatch")).toBe(false);
  });

  it("is a confirmed delivery's next step; once out, Delivered is", () => {
    expect(primaryOrderAction(card({ paymentMethod: "UPI", paymentStatus: "PAID" }), false)).toBe("dispatch");
    expect(
      primaryOrderAction(
        card({ paymentMethod: "UPI", paymentStatus: "PAID", outForDeliveryAt: "2026-10-16T10:00:00.000Z" }),
        false,
      ),
    ).toBe("deliver");
  });
});

describe("availableOrderActions: Mark ready and Not ready", () => {
  const card = (over: Partial<Parameters<typeof availableOrderActions>[0]> = {}) => ({
    fulfilmentStatus: "CONFIRMED" as FulfilmentStatus,
    paymentStatus: "PAID" as PaymentStatus,
    paymentMethod: "UPI" as PaymentMethod,
    displayState: "PAID" as OrderDisplayState,
    fulfilmentType: "PICKUP" as const,
    ...over,
  });
  const at = "2026-10-16T10:00:00.000Z";

  it("offers Mark ready on a live pickup order, frozen drop included (handover bookkeeping)", () => {
    expect(availableOrderActions(card(), false).has("mark_ready")).toBe(true);
    expect(availableOrderActions(card({ fulfilmentStatus: "PLACED" }), true).has("mark_ready")).toBe(true);
    expect(primaryOrderAction(card(), false)).toBe("mark_ready");
  });

  it("not on a delivery (it goes out instead), once ready, or when finished", () => {
    expect(availableOrderActions(card({ fulfilmentType: "DELIVERY" }), false).has("mark_ready")).toBe(false);
    expect(availableOrderActions(card({ readyAt: at }), false).has("mark_ready")).toBe(false);
    expect(availableOrderActions(card({ fulfilmentStatus: "DELIVERED" }), false).has("mark_ready")).toBe(false);
    expect(availableOrderActions(card({ fulfilmentStatus: "CANCELLED" }), false).has("mark_ready")).toBe(false);
  });

  it("once ready, the next step is the handover, and Not ready takes it back", () => {
    expect(primaryOrderAction(card({ readyAt: at }), false)).toBe("deliver");
    expect(availableOrderActions(card({ readyAt: at }), false).has("unready")).toBe(true);
    expect(availableOrderActions(card({ fulfilmentType: "DELIVERY", outForDeliveryAt: at }), false).has("unready")).toBe(true);
    expect(availableOrderActions(card(), false).has("unready")).toBe(false);
    expect(availableOrderActions(card({ readyAt: at, fulfilmentStatus: "DELIVERED" }), false).has("unready")).toBe(false);
  });

  it("checkOrderAction agrees on the server side", () => {
    const o = { fulfilmentStatus: "CONFIRMED" as const, paymentStatus: "PAID" as const };
    expect(checkOrderAction("mark_ready", null, o)).toEqual({ ok: true });
    expect(checkOrderAction("mark_ready", "FROZEN", o)).toEqual({ ok: true });
    expect(checkOrderAction("mark_ready", null, { ...o, fulfilmentStatus: "DELIVERED" })).toEqual({
      ok: false,
      error: "invalid_state",
    });
    expect(checkOrderAction("unready", "FULFILLED", o)).toEqual({ ok: true });
    expect(checkOrderAction("unready", null, { ...o, fulfilmentStatus: "PLACED" })).toEqual({
      ok: false,
      error: "invalid_state",
    });
  });
});

describe("paymentBadge", () => {
  const b = (
    displayState: OrderDisplayState,
    paymentStatus: PaymentStatus,
    extra: { fulfilmentType?: "PICKUP" | "DELIVERY"; paidOnline?: boolean; bucket?: BoardBucket } = {},
  ) => paymentBadge({ displayState, paymentStatus, fulfilmentType: extra.fulfilmentType ?? "DELIVERY", ...extra });

  it("says where the money stands, in words", () => {
    expect(b("PAID", "PAID")).toEqual({ kind: "paid", label: "Paid" });
    expect(b("PAID", "PAID", { paidOnline: true }).label).toBe("Paid online");
    expect(b("DELIVERED", "PAID")).toEqual({ kind: "paid", label: "Paid" });
    expect(b("PAYMENT_SUBMITTED", "PENDING")).toEqual({ kind: "check", label: "Payment to check" });
    expect(b("PAY_ON_DELIVERY", "PENDING").label).toBe("Pay on delivery");
    expect(b("PAY_ON_DELIVERY", "PENDING", { fulfilmentType: "PICKUP" }).label).toBe("Pay at pickup");
    expect(b("AWAITING_PAYMENT", "PENDING")).toEqual({ kind: "unpaid", label: "Not paid yet" });
    expect(b("AWAITING_PAYMENT", "PENDING", { bucket: "awaiting_online" }).kind).toBe("waiting_online");
    expect(b("CANCELLED", "PAID").kind).toBe("cancelled");
    expect(b("EXPIRED", "PENDING").kind).toBe("expired");
  });

  it("flags a handed-over order that is still unpaid", () => {
    expect(b("DELIVERED", "PENDING")).toEqual({ kind: "due", label: "Payment due" });
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

describe("primaryOrderAction", () => {
  type Row = [
    string,
    {
      displayState: OrderDisplayState;
      fulfilmentStatus: FulfilmentStatus;
      paymentStatus: PaymentStatus;
      paymentMethod: PaymentMethod;
    },
    boolean,
    string | null,
  ];
  const o = (
    displayState: OrderDisplayState,
    fulfilmentStatus: FulfilmentStatus,
    paymentStatus: PaymentStatus,
    paymentMethod: PaymentMethod,
  ) => ({ displayState, fulfilmentStatus, paymentStatus, paymentMethod });
  const cases: Row[] = [
    ["new, buyer says paid", o("PAYMENT_SUBMITTED", "PLACED", "PENDING", "UPI"), false, "mark_paid"],
    ["confirmed, buyer says paid", o("PAYMENT_SUBMITTED", "CONFIRMED", "PENDING", "UPI"), false, "mark_paid"],
    ["new, UPI unpaid", o("AWAITING_PAYMENT", "PLACED", "PENDING", "UPI"), false, "confirm"],
    ["new, pay on delivery", o("PAY_ON_DELIVERY", "PLACED", "PENDING", "CASH"), false, "confirm"],
    ["new, already paid", o("PAID", "PLACED", "PAID", "UPI"), false, "confirm"],
    // No fulfilmentType here, so these read as pickups: the next step is Mark ready.
    ["new on a locked drop", o("PAY_ON_DELIVERY", "PLACED", "PENDING", "CASH"), true, "mark_ready"],
    ["confirmed, paid", o("PAID", "CONFIRMED", "PAID", "UPI"), false, "mark_ready"],
    ["confirmed, pay on delivery", o("PAY_ON_DELIVERY", "CONFIRMED", "PENDING", "CASH"), false, "mark_ready"],
    ["confirmed, UPI unpaid", o("AWAITING_PAYMENT", "CONFIRMED", "PENDING", "UPI"), false, "mark_ready"],
    ["delivered, still unpaid", o("DELIVERED", "DELIVERED", "PENDING", "UPI"), false, "mark_paid"],
    ["delivered and paid", o("DELIVERED", "DELIVERED", "PAID", "UPI"), false, null],
    ["cancelled", o("CANCELLED", "CANCELLED", "PENDING", "UPI"), false, null],
  ];
  it.each(cases)("%s", (_name, order, frozen, expected) => {
    const primary = primaryOrderAction(order, frozen);
    expect(primary).toBe(expected);
    // Never something the card would not offer.
    if (primary) expect(availableOrderActions(order, frozen).has(primary)).toBe(true);
  });

  it("a buyer's claim gets one answer: no separate Confirm beside Payment received", () => {
    const claimed = o("PAYMENT_SUBMITTED", "PLACED", "PENDING", "UPI");
    const actions = availableOrderActions(claimed, false);
    expect(actions.has("mark_paid")).toBe(true);
    expect(actions.has("reject_payment")).toBe(true);
    expect(actions.has("confirm")).toBe(false);
    // Without a claim the seller may still accept an order before the money arrives.
    expect(availableOrderActions(o("AWAITING_PAYMENT", "PLACED", "PENDING", "UPI"), false).has("confirm")).toBe(true);
  });

  it("markPaidNeedsConfirm: only a buyer's claim lets one tap mark an order paid", () => {
    expect(markPaidNeedsConfirm({ displayState: "PAYMENT_SUBMITTED" })).toBe(false);
    for (const s of ["AWAITING_PAYMENT", "PAY_ON_DELIVERY", "DELIVERED"] as const) {
      expect(markPaidNeedsConfirm({ displayState: s })).toBe(true);
    }
  });
});

describe("searchOrders / filterByHandover", () => {
  const orders = [
    {
      id: "a",
      customerName: "Priya Nair",
      customerPhone: "+919876543210",
      billNumber: "AWZ-20261005-0001",
      fulfilmentType: "PICKUP" as const,
    },
    {
      id: "b",
      customerName: "Ravi",
      customerPhone: "+919812300077",
      billNumber: "AWZ-20261005-0012",
      fulfilmentType: "DELIVERY" as const,
    },
    { id: "c", customerName: null, customerPhone: null, billNumber: "AWZ-20261004-0003", fulfilmentType: null },
  ];
  const ids = (q: string) => searchOrders(orders, q).map((x) => x.id);

  it("an empty query keeps every order", () => {
    expect(ids("")).toEqual(["a", "b", "c"]);
    expect(ids("   ")).toEqual(["a", "b", "c"]);
  });

  it("matches the buyer's name, any case", () => {
    expect(ids("priya")).toEqual(["a"]);
    expect(ids(" NAIR ")).toEqual(["a"]);
    expect(ids("zzz")).toEqual([]);
  });

  it("matches the bill number", () => {
    expect(ids("0012")).toEqual(["b"]);
    expect(ids("awz-20261004")).toEqual(["c"]);
  });

  it("matches the end of the phone number, not its middle", () => {
    expect(ids("3210")).toEqual(["a"]);
    expect(ids("0077")).toEqual(["b"]);
    expect(ids("98765 43210")).toEqual(["a"]);
    expect(ids("8765")).toEqual([]);
  });

  it("filterByHandover: pickups on one side, everything else is a delivery", () => {
    expect(filterByHandover(orders, "all")).toHaveLength(3);
    expect(filterByHandover(orders, "pickup").map((x) => x.id)).toEqual(["a"]);
    expect(filterByHandover(orders, "delivery").map((x) => x.id)).toEqual(["b", "c"]);
  });
});
