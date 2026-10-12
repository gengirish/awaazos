import type { DropStatus, FulfilmentStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep Prisma / env / KV out of the unit run; money helpers are spied on.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpDropOrderSignal: vi.fn() }));
vi.mock("@/lib/drops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drops")>()),
  markOrderPaid: vi.fn(),
  cancelOrder: vi.fn(),
}));

import { cancelOrder, markOrderPaid } from "@/lib/drops";
import {
  OrderActionError,
  applyStorefrontOrderAction,
  checkOrderAction,
  storefrontOrderScope,
  type OrderAction,
} from "@/lib/storefront-order-actions";

type OrderState = {
  fulfilmentStatus: FulfilmentStatus | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
};

/** Minimal fake of the bits of Prisma.TransactionClient the module touches. */
function fakeTx(order: OrderState | null, updateCount = 1) {
  const tx = {
    transaction: {
      findFirst: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: "o1", row: true }),
    },
  };
  return { tx, asTx: tx as unknown as Prisma.TransactionClient };
}

const scopeDrop = storefrontOrderScope({ orderId: "o1", vendorId: "v1", dropId: "d1" });
const scopeMenu = storefrontOrderScope({ orderId: "o1", vendorId: "v1", dropId: null });

const placedUpi: OrderState = { fulfilmentStatus: "PLACED", paymentStatus: "PENDING", paymentMethod: "UPI" };
const placedCash: OrderState = { fulfilmentStatus: "PLACED", paymentStatus: "PENDING", paymentMethod: "CASH" };

async function expectActionError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OrderActionError);
  expect((err as OrderActionError).status).toBe(status);
  expect((err as OrderActionError).code).toBe(code);
}

beforeEach(() => {
  vi.mocked(markOrderPaid).mockReset().mockResolvedValue(true);
  vi.mocked(cancelOrder).mockReset().mockResolvedValue(true);
});

describe("storefrontOrderScope", () => {
  it("pins id, vendor, source and drop (null for menu orders)", () => {
    expect(scopeDrop).toEqual({ id: "o1", vendorId: "v1", source: "STOREFRONT", dropId: "d1" });
    expect(scopeMenu).toEqual({ id: "o1", vendorId: "v1", source: "STOREFRONT", dropId: null });
  });
});

describe("checkOrderAction with no drop (menu orders)", () => {
  const o = (fs: FulfilmentStatus, ps: PaymentStatus = "PENDING") => ({ fulfilmentStatus: fs, paymentStatus: ps });

  it("never applies the frozen rule", () => {
    expect(checkOrderAction("confirm", null, o("PLACED"))).toEqual({ ok: true });
    expect(checkOrderAction("cancel", null, o("CONFIRMED"))).toEqual({ ok: true });
  });

  it("still enforces state transitions", () => {
    expect(checkOrderAction("confirm", null, o("CONFIRMED"))).toEqual({ ok: false, error: "invalid_state" });
    expect(checkOrderAction("cancel", null, o("DELIVERED"))).toEqual({ ok: false, error: "invalid_state" });
    expect(checkOrderAction("undeliver", null, o("CONFIRMED"))).toEqual({ ok: false, error: "invalid_state" });
  });

  it("matches the drop rule for non-frozen drops", () => {
    const actions: OrderAction[] = ["confirm", "mark_paid", "cancel", "deliver", "undeliver"];
    const states: FulfilmentStatus[] = ["PLACED", "CONFIRMED", "DELIVERED", "CANCELLED"];
    for (const a of actions) {
      for (const fs of states) {
        for (const ds of ["OPEN", "CLOSED", "DRAFT"] as DropStatus[]) {
          expect(checkOrderAction(a, null, o(fs))).toEqual(checkOrderAction(a, ds, o(fs)));
        }
      }
    }
  });
});

describe("applyStorefrontOrderAction", () => {
  it("reads the order with the full compound scope and 404s when it is out of scope", async () => {
    const { tx, asTx } = fakeTx(null);
    await expectActionError(
      applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "confirm", dropStatus: null }),
      404,
      "Not found",
    );
    expect(tx.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "o1", vendorId: "v1", source: "STOREFRONT", dropId: null } }),
    );
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("confirm: conditional PLACED → CONFIRMED write within scope, returns the reloaded row", async () => {
    const { tx, asTx } = fakeTx(placedUpi);
    const row = await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "confirm", dropStatus: null });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { ...scopeMenu, fulfilmentStatus: "PLACED" },
      data: { fulfilmentStatus: "CONFIRMED" },
    });
    expect(tx.transaction.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: scopeMenu }));
    expect(row).toEqual({ id: "o1", row: true });
  });

  it("confirm that loses a race → 409 invalid_state", async () => {
    const { asTx } = fakeTx(placedUpi, 0);
    await expectActionError(
      applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "confirm", dropStatus: null }),
      409,
      "invalid_state",
    );
  });

  it("frozen drop: confirm / cancel → 409 drop_frozen before any write", async () => {
    for (const action of ["confirm", "cancel"] as const) {
      const { tx, asTx } = fakeTx({ ...placedUpi, fulfilmentStatus: "CONFIRMED" });
      await expectActionError(
        applyStorefrontOrderAction(asTx, { scope: scopeDrop, action, dropStatus: "FROZEN" }),
        409,
        "drop_frozen",
      );
      expect(tx.transaction.updateMany).not.toHaveBeenCalled();
      expect(cancelOrder).not.toHaveBeenCalled();
    }
  });

  it("frozen drop still allows deliver and mark_paid", async () => {
    const { asTx } = fakeTx({ ...placedUpi, fulfilmentStatus: "CONFIRMED" });
    await applyStorefrontOrderAction(asTx, { scope: scopeDrop, action: "mark_paid", dropStatus: "FULFILLED" });
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
    const second = fakeTx({ ...placedUpi, fulfilmentStatus: "CONFIRMED" });
    await applyStorefrontOrderAction(second.asTx, { scope: scopeDrop, action: "deliver", dropStatus: "FROZEN" });
    expect(second.tx.transaction.updateMany).toHaveBeenCalledTimes(1);
  });

  it("mark_paid goes through markOrderPaid (DailySummary) and 409s when it was already paid", async () => {
    const { asTx } = fakeTx(placedUpi);
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "mark_paid", dropStatus: null });
    expect(markOrderPaid).toHaveBeenCalledWith(asTx, expect.objectContaining({ vendorId: "v1", transactionId: "o1" }));

    vi.mocked(markOrderPaid).mockResolvedValueOnce(false);
    await expectActionError(
      applyStorefrontOrderAction(fakeTx(placedUpi).asTx, { scope: scopeMenu, action: "mark_paid", dropStatus: null }),
      409,
      "invalid_state",
    );
  });

  it("mark_paid on an already-paid order is rejected by the pre-flight", async () => {
    const { asTx } = fakeTx({ ...placedUpi, paymentStatus: "PAID" });
    await expectActionError(
      applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "mark_paid", dropStatus: null }),
      409,
      "invalid_state",
    );
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it("cancel goes through cancelOrder (reverses revenue when paid)", async () => {
    const { tx, asTx } = fakeTx({ ...placedUpi, paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED" });
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "cancel", dropStatus: null });
    expect(cancelOrder).toHaveBeenCalledWith(asTx, expect.objectContaining({ vendorId: "v1", transactionId: "o1" }));
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("deliver on unpaid cash marks it paid in the same transaction", async () => {
    const { tx, asTx } = fakeTx(placedCash);
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "deliver", dropStatus: null });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { ...scopeMenu, fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } },
      data: { fulfilmentStatus: "DELIVERED" },
    });
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("deliver on unpaid UPI leaves payment alone", async () => {
    const { asTx } = fakeTx(placedUpi);
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "deliver", dropStatus: null });
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it("deliver on already-paid cash does not pay twice", async () => {
    const { asTx } = fakeTx({ ...placedCash, paymentStatus: "PAID" });
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "deliver", dropStatus: null });
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it("undeliver: DELIVERED → CONFIRMED within scope", async () => {
    const { tx, asTx } = fakeTx({ ...placedCash, fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" });
    await applyStorefrontOrderAction(asTx, { scope: scopeDrop, action: "undeliver", dropStatus: "OPEN" });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { ...scopeDrop, fulfilmentStatus: "DELIVERED" },
      data: { fulfilmentStatus: "CONFIRMED" },
    });
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it("reject_payment (Not received): clears the claim and the UTR, stamps paymentRejectedAt, within scope", async () => {
    const now = new Date("2026-10-11T10:00:00.000Z");
    const { tx, asTx } = fakeTx(placedUpi);
    await applyStorefrontOrderAction(asTx, { scope: scopeMenu, action: "reject_payment", dropStatus: null, now });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        ...scopeMenu,
        paymentStatus: "PENDING",
        fulfilmentStatus: { not: "CANCELLED" },
        OR: [{ paymentClaimedAt: { not: null } }, { upiRef: { not: null } }],
      },
      data: { paymentClaimedAt: null, upiRef: null, paymentRejectedAt: now },
    });
    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("reject_payment with no claim to answer → 409 invalid_state", async () => {
    const { asTx } = fakeTx(placedUpi, 0);
    await expectActionError(
      applyStorefrontOrderAction(asTx, { scope: scopeDrop, action: "reject_payment", dropStatus: "OPEN" }),
      409,
      "invalid_state",
    );
  });

  it("reject_payment is refused once paid or cancelled, and allowed on a frozen drop", async () => {
    for (const state of [
      { ...placedUpi, paymentStatus: "PAID" as const },
      { ...placedUpi, fulfilmentStatus: "CANCELLED" as const },
    ]) {
      const { tx, asTx } = fakeTx(state);
      await expectActionError(
        applyStorefrontOrderAction(asTx, { scope: scopeDrop, action: "reject_payment", dropStatus: "OPEN" }),
        409,
        "invalid_state",
      );
      expect(tx.transaction.updateMany).not.toHaveBeenCalled();
    }
    const { tx, asTx } = fakeTx(placedUpi);
    await applyStorefrontOrderAction(asTx, { scope: scopeDrop, action: "reject_payment", dropStatus: "FROZEN" });
    expect(tx.transaction.updateMany).toHaveBeenCalledTimes(1);
  });
});
