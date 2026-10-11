import type { FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { availableOrderActions, checkOrderAction } from "@/lib/drops-board";
import {
  BULK_ORDER_ACTIONS,
  bulkActionCounts,
  bulkActionsFor,
  bulkNeedsConfirm,
  bulkOrderActionSchema,
  bulkResultMessage,
  bulkTargets,
  cashToCollectPaise,
  isBulkSelectable,
  pruneSelection,
} from "@/lib/order-bulk";

type O = {
  id: string;
  fulfilmentStatus: FulfilmentStatus | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
};

const o = (
  id: string,
  fulfilmentStatus: FulfilmentStatus,
  paymentMethod: PaymentMethod = "UPI",
  paymentStatus: PaymentStatus = "PENDING",
  totalPaise = 10_000,
): O => ({ id, fulfilmentStatus, paymentStatus, paymentMethod, totalPaise });

describe("BULK_ORDER_ACTIONS", () => {
  it("is the forward actions only — never cancel or undeliver", () => {
    expect([...BULK_ORDER_ACTIONS]).toEqual(["confirm", "mark_paid", "deliver"]);
  });
});

describe("availableOrderActions: Not received", () => {
  const base = { fulfilmentStatus: "PLACED", paymentStatus: "PENDING", paymentMethod: "UPI" } as const;

  it("is offered only while the buyer's claim is waiting for an answer", () => {
    expect(availableOrderActions({ ...base, displayState: "PAYMENT_SUBMITTED" }, false).has("reject_payment")).toBe(true);
    expect(availableOrderActions({ ...base, displayState: "PAYMENT_SUBMITTED" }, true).has("reject_payment")).toBe(true);
    expect(availableOrderActions({ ...base, displayState: "AWAITING_PAYMENT" }, false).has("reject_payment")).toBe(false);
    expect(availableOrderActions({ ...base, paymentStatus: "PAID", displayState: "PAID" }, false).has("reject_payment")).toBe(false);
    expect(availableOrderActions(base, false).has("reject_payment")).toBe(false);
  });

  it("is never a bulk action", () => {
    expect(BULK_ORDER_ACTIONS as readonly string[]).not.toContain("reject_payment");
  });
});

describe("availableOrderActions (card buttons)", () => {
  it("matches the card rules for a new UPI order", () => {
    expect([...availableOrderActions(o("a", "PLACED"), false)].sort()).toEqual(
      ["cancel", "confirm", "deliver", "mark_paid"].sort(),
    );
  });

  it("hides mark paid on an undelivered pay-on-delivery order", () => {
    expect(availableOrderActions(o("a", "CONFIRMED", "CASH"), false).has("mark_paid")).toBe(false);
    expect(availableOrderActions(o("a", "DELIVERED", "CASH"), false).has("mark_paid")).toBe(true);
  });

  it("locks confirm and cancel once frozen", () => {
    const a = availableOrderActions(o("a", "PLACED"), true);
    expect(a.has("confirm")).toBe(false);
    expect(a.has("cancel")).toBe(false);
    expect(a.has("deliver")).toBe(true);
  });

  it("never offers an action the server pre-flight would reject", () => {
    const states: FulfilmentStatus[] = ["PLACED", "CONFIRMED", "DELIVERED", "CANCELLED"];
    for (const fs of states) {
      for (const pm of ["UPI", "CASH"] as PaymentMethod[]) {
        for (const ps of ["PENDING", "PAID"] as PaymentStatus[]) {
          for (const frozen of [false, true]) {
            const order = o("x", fs, pm, ps);
            for (const action of availableOrderActions(order, frozen)) {
              expect(checkOrderAction(action, frozen ? "FROZEN" : "OPEN", order)).toEqual({ ok: true });
            }
          }
        }
      }
    }
  });
});

describe("bulkActionsFor / isBulkSelectable", () => {
  it("offers confirm, mark paid and deliver on a new UPI order", () => {
    expect(bulkActionsFor(o("a", "PLACED"), false)).toEqual(["confirm", "mark_paid", "deliver"]);
  });

  it("offers deliver only for a confirmed pay-on-delivery order", () => {
    expect(bulkActionsFor(o("a", "CONFIRMED", "CASH"), false)).toEqual(["deliver"]);
  });

  it("drops confirm on a frozen drop", () => {
    expect(bulkActionsFor(o("a", "PLACED"), true)).toEqual(["mark_paid", "deliver"]);
  });

  it("delivered-and-paid, cancelled and delivered-unpaid-UPI orders", () => {
    expect(isBulkSelectable(o("a", "DELIVERED", "UPI", "PAID"), false)).toBe(false);
    expect(isBulkSelectable(o("a", "CANCELLED"), false)).toBe(false);
    // Undeliver is per-order only; mark paid still fits.
    expect(bulkActionsFor(o("a", "DELIVERED"), false)).toEqual(["mark_paid"]);
  });
});

describe("bulkTargets / bulkActionCounts", () => {
  const orders = [
    o("p1", "PLACED"),
    o("p2", "PLACED", "CASH"),
    o("c1", "CONFIRMED", "UPI", "PAID"),
    o("x1", "CANCELLED"),
  ];
  const sel = new Set(["p1", "p2", "c1", "x1"]);

  it("keeps only selected orders the action fits, in board order", () => {
    expect(bulkTargets(orders, sel, "confirm", false).map((t) => t.id)).toEqual(["p1", "p2"]);
    expect(bulkTargets(orders, sel, "mark_paid", false).map((t) => t.id)).toEqual(["p1"]);
    expect(bulkTargets(orders, sel, "deliver", false).map((t) => t.id)).toEqual(["p1", "p2", "c1"]);
    expect(bulkTargets(orders, new Set(["p2"]), "mark_paid", false)).toEqual([]);
  });

  it("counts per action", () => {
    expect(bulkActionCounts(orders, sel, false)).toEqual({ confirm: 2, mark_paid: 1, deliver: 3 });
    expect(bulkActionCounts(orders, sel, true)).toEqual({ confirm: 0, mark_paid: 1, deliver: 3 });
  });
});

describe("pruneSelection", () => {
  it("returns the same set when nothing changed", () => {
    const sel = new Set(["a"]);
    expect(pruneSelection(sel, [o("a", "PLACED")], false)).toBe(sel);
  });

  it("drops ids that are gone or no longer actionable", () => {
    const sel = new Set(["a", "b", "gone"]);
    const next = pruneSelection(sel, [o("a", "PLACED"), o("b", "CANCELLED")], false);
    expect([...next]).toEqual(["a"]);
  });
});

describe("money confirm", () => {
  it("sums only unpaid cash orders", () => {
    expect(
      cashToCollectPaise([o("a", "PLACED", "CASH"), o("b", "PLACED", "UPI"), o("c", "PLACED", "CASH", "PAID")]),
    ).toBe(10_000);
  });

  it("asks before mark paid always, before deliver only when cash is collected", () => {
    expect(bulkNeedsConfirm("mark_paid", [o("a", "PLACED")])).toBe(true);
    expect(bulkNeedsConfirm("deliver", [o("a", "PLACED")])).toBe(false);
    expect(bulkNeedsConfirm("deliver", [o("a", "PLACED", "CASH")])).toBe(true);
    expect(bulkNeedsConfirm("confirm", [o("a", "PLACED", "CASH")])).toBe(false);
  });
});

describe("bulkOrderActionSchema", () => {
  it("accepts 1..50 unique ids and a bulk action", () => {
    expect(bulkOrderActionSchema.safeParse({ orderIds: ["a"], action: "confirm" }).success).toBe(true);
    const fifty = Array.from({ length: 50 }, (_, i) => `id${i}`);
    expect(bulkOrderActionSchema.safeParse({ orderIds: fifty, action: "deliver" }).success).toBe(true);
  });

  it("rejects empty, >50, duplicates and non-bulk actions", () => {
    expect(bulkOrderActionSchema.safeParse({ orderIds: [], action: "confirm" }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `id${i}`);
    expect(bulkOrderActionSchema.safeParse({ orderIds: many, action: "confirm" }).success).toBe(false);
    expect(bulkOrderActionSchema.safeParse({ orderIds: ["a", "a"], action: "confirm" }).success).toBe(false);
    expect(bulkOrderActionSchema.safeParse({ orderIds: ["a"], action: "cancel" }).success).toBe(false);
    expect(bulkOrderActionSchema.safeParse({ orderIds: ["a"], action: "undeliver" }).success).toBe(false);
  });
});

describe("bulkResultMessage", () => {
  it("all succeeded", () => {
    expect(bulkResultMessage("confirm", { succeeded: ["a", "b"], failed: [] })).toEqual({
      kind: "success",
      text: "2 orders confirmed",
    });
  });

  it("partial failure explains why", () => {
    const m = bulkResultMessage("mark_paid", { succeeded: ["a"], failed: [{ id: "b", error: "invalid_state" }] });
    expect(m.kind).toBe("partial");
    expect(m.text).toBe("1 order marked paid. 1 order not changed (they changed on another device). Refreshed.");
  });

  it("frozen and total failure", () => {
    const m = bulkResultMessage("confirm", { succeeded: [], failed: [{ id: "b", error: "drop_frozen" }] });
    expect(m).toEqual({ kind: "error", text: "No orders changed (orders are frozen). Refreshed." });
  });
});
