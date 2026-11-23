import type { FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { availableOrderActions, checkOrderAction, fixStatusActions, primaryOrderAction } from "@/lib/drops-board";
import { BULK_ORDER_ACTIONS, bulkActionsFor } from "@/lib/order-bulk";

type Card = Parameters<typeof availableOrderActions>[0];

const card = (over: Partial<Card> = {}): Card => ({
  fulfilmentStatus: "CONFIRMED" as FulfilmentStatus,
  paymentStatus: "PENDING" as PaymentStatus,
  paymentMethod: "UPI" as PaymentMethod,
  fulfilmentType: "PICKUP",
  readyAt: null,
  outForDeliveryAt: null,
  ...over,
});

describe("fixStatusActions (the card's Fix status list)", () => {
  it("a plain accepted, unpaid order has nothing to fix", () => {
    expect(fixStatusActions(card(), false)).toEqual([]);
  });

  it("offers only the corrective actions valid for the state, in a fixed order", () => {
    expect(fixStatusActions(card({ readyAt: "2026-11-20T10:00:00.000Z" }), false)).toEqual(["unready"]);
    expect(fixStatusActions(card({ paymentStatus: "PAID" }), false)).toEqual(["mark_unpaid"]);
    expect(
      fixStatusActions(card({ paymentStatus: "PAID", readyAt: "2026-11-20T10:00:00.000Z" }), false),
    ).toEqual(["unready", "mark_unpaid"]);
    expect(fixStatusActions(card({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" }), false)).toEqual([
      "undeliver",
      "mark_unpaid",
    ]);
    expect(fixStatusActions(card({ fulfilmentStatus: "CANCELLED" }), false)).toEqual(["uncancel"]);
    expect(fixStatusActions(card({ fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED" }), false)).toEqual([
      "uncancel",
    ]);
  });

  it("never for a Razorpay payment: no Not paid yet, no Reopen", () => {
    expect(fixStatusActions(card({ paymentStatus: "PAID", paidOnline: true }), false)).toEqual([]);
    expect(
      fixStatusActions(card({ fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED", paidOnline: true }), false),
    ).toEqual([]);
    // Undo delivered is about the handover, not the money: still offered.
    expect(
      fixStatusActions(card({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID", paidOnline: true }), false),
    ).toEqual(["undeliver"]);
  });

  it("a frozen drop keeps the payment fix but can't reopen an order", () => {
    expect(fixStatusActions(card({ paymentStatus: "PAID" }), true)).toEqual(["mark_unpaid"]);
    expect(fixStatusActions(card({ fulfilmentStatus: "CANCELLED" }), true)).toEqual([]);
  });

  it("cash at the door: undo a delivered-and-collected order, then the money", () => {
    const o = card({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID", paymentMethod: "CASH" });
    expect(fixStatusActions(o, false)).toEqual(["undeliver", "mark_unpaid"]);
  });

  it("is never the big button and never bulk", () => {
    const states: Card[] = [
      card({ fulfilmentStatus: "CANCELLED" }),
      card({ paymentStatus: "PAID" }),
      card({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" }),
    ];
    for (const o of states) {
      const primary = primaryOrderAction(o, false);
      expect(primary === "mark_unpaid" || primary === "uncancel").toBe(false);
      expect(bulkActionsFor(o, false)).not.toContain("mark_unpaid");
      expect(bulkActionsFor(o, false)).not.toContain("uncancel");
    }
    expect(BULK_ORDER_ACTIONS).toEqual(["confirm", "mark_paid", "mark_ready", "deliver"]);
  });

  it("an order awaiting an online payment offers no fix", () => {
    expect(fixStatusActions(card({ fulfilmentStatus: "PLACED", bucket: "awaiting_online" }), false)).toEqual([]);
  });
});

describe("checkOrderAction: mark_unpaid and uncancel guards", () => {
  const o = (fulfilmentStatus: FulfilmentStatus | null, paymentStatus: PaymentStatus, paidOnline = false) => ({
    fulfilmentStatus,
    paymentStatus,
    paidOnline,
  });

  it("mark_unpaid: only a live or handed-over order marked paid by hand", () => {
    expect(checkOrderAction("mark_unpaid", "OPEN", o("CONFIRMED", "PAID"))).toEqual({ ok: true });
    expect(checkOrderAction("mark_unpaid", null, o("DELIVERED", "PAID"))).toEqual({ ok: true });
    expect(checkOrderAction("mark_unpaid", "OPEN", o("CONFIRMED", "PENDING"))).toEqual({ ok: false, error: "invalid_state" });
    expect(checkOrderAction("mark_unpaid", "OPEN", o("CANCELLED", "REFUNDED"))).toEqual({ ok: false, error: "invalid_state" });
    expect(checkOrderAction("mark_unpaid", "OPEN", o("CONFIRMED", "PAID", true))).toEqual({ ok: false, error: "paid_online" });
    // Payment bookkeeping is still allowed on a frozen drop.
    expect(checkOrderAction("mark_unpaid", "FROZEN", o("CONFIRMED", "PAID"))).toEqual({ ok: true });
  });

  it("uncancel: only a cancelled order, never Razorpay-paid, never on a frozen drop", () => {
    expect(checkOrderAction("uncancel", "OPEN", o("CANCELLED", "PENDING"))).toEqual({ ok: true });
    expect(checkOrderAction("uncancel", null, o("CANCELLED", "REFUNDED"))).toEqual({ ok: true });
    // Past the cut-off is fine: it's the seller's own order to reopen (stock is checked on the server).
    expect(checkOrderAction("uncancel", "CLOSED", o("CANCELLED", "PENDING"))).toEqual({ ok: true });
    expect(checkOrderAction("uncancel", "OPEN", o("CONFIRMED", "PENDING"))).toEqual({ ok: false, error: "invalid_state" });
    expect(checkOrderAction("uncancel", "OPEN", o("CANCELLED", "REFUNDED", true))).toEqual({ ok: false, error: "paid_online" });
    expect(checkOrderAction("uncancel", "FROZEN", o("CANCELLED", "PENDING"))).toEqual({ ok: false, error: "drop_frozen" });
    expect(checkOrderAction("uncancel", "FULFILLED", o("CANCELLED", "PENDING"))).toEqual({ ok: false, error: "drop_frozen" });
  });

  it("the paid-online flag changes nothing else", () => {
    expect(checkOrderAction("undeliver", "OPEN", o("DELIVERED", "PAID", true))).toEqual({ ok: true });
    expect(checkOrderAction("cancel", "OPEN", o("CONFIRMED", "PAID", true))).toEqual({ ok: true });
  });
});
