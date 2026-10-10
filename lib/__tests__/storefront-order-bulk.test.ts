import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep Prisma / env out of the unit run: the per-order action itself is mocked.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops", () => ({ markOrderPaid: vi.fn(), cancelOrder: vi.fn() }));
vi.mock("@/lib/drops-board-server", () => ({ boardOrderSelect: {} }));
vi.mock("@/lib/storefront-order-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storefront-order-actions")>()),
  applyStorefrontOrderAction: vi.fn(),
}));

import { OrderActionError, applyStorefrontOrderAction } from "@/lib/storefront-order-actions";
import { runBulkStorefrontOrderAction, type RunInTransaction } from "@/lib/storefront-order-bulk";

const apply = vi.mocked(applyStorefrontOrderAction);

function fakeTxRunner(drop: { status: string } | null = { status: "OPEN" }) {
  const tx = { drop: { findFirst: vi.fn().mockResolvedValue(drop) } };
  const calls = { count: 0 };
  const run: RunInTransaction = async (fn) => {
    calls.count += 1;
    return fn(tx as unknown as Prisma.TransactionClient);
  };
  return { tx, run, calls };
}

beforeEach(() => {
  apply.mockReset();
});

describe("runBulkStorefrontOrderAction", () => {
  it("runs one transaction per order with the single-order compound scope", async () => {
    apply.mockImplementation(async (_tx, { scope }) => ({ id: scope.id }) as never);
    const { run, calls, tx } = fakeTxRunner();

    const out = await runBulkStorefrontOrderAction({
      runInTransaction: run,
      vendorId: "v1",
      dropId: "d1",
      orderIds: ["o1", "o2"],
      action: "confirm",
    });

    expect(calls.count).toBe(2);
    expect(out.succeeded).toEqual(["o1", "o2"]);
    expect(out.failed).toEqual([]);
    expect(out.updated).toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(apply.mock.calls[0][1]).toMatchObject({
      scope: { id: "o1", vendorId: "v1", source: "STOREFRONT", dropId: "d1" },
      action: "confirm",
      dropStatus: "OPEN",
    });
    // Drop re-read inside every transaction, always with the vendor in the where.
    expect(tx.drop.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.drop.findFirst).toHaveBeenCalledWith({ where: { id: "d1", vendorId: "v1" }, select: { status: true } });
  });

  it("menu orders: dropId null, no drop read, no frozen status", async () => {
    apply.mockResolvedValue({ id: "o1" } as never);
    const { run, tx } = fakeTxRunner();

    await runBulkStorefrontOrderAction({
      runInTransaction: run,
      vendorId: "v1",
      dropId: null,
      orderIds: ["o1"],
      action: "mark_paid",
    });

    expect(tx.drop.findFirst).not.toHaveBeenCalled();
    expect(apply.mock.calls[0][1]).toMatchObject({
      scope: { id: "o1", vendorId: "v1", source: "STOREFRONT", dropId: null },
      dropStatus: null,
    });
  });

  it("one bad order does not stop the rest; codes are mapped, unknown ids are not_found", async () => {
    apply.mockImplementation(async (_tx, { scope }) => {
      if (scope.id === "other-tenant") throw new OrderActionError(404, "Not found");
      if (scope.id === "stale") throw new OrderActionError(409, "invalid_state");
      if (scope.id === "frozen") throw new OrderActionError(409, "drop_frozen");
      if (scope.id === "boom") throw new Error("connection reset");
      return { id: scope.id } as never;
    });
    const { run } = fakeTxRunner();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await runBulkStorefrontOrderAction({
      runInTransaction: run,
      vendorId: "v1",
      dropId: null,
      orderIds: ["ok1", "other-tenant", "stale", "frozen", "boom", "ok2"],
      action: "deliver",
    });

    expect(out.succeeded).toEqual(["ok1", "ok2"]);
    expect(out.failed).toEqual([
      { id: "other-tenant", error: "not_found" },
      { id: "stale", error: "invalid_state" },
      { id: "frozen", error: "drop_frozen" },
      { id: "boom", error: "error" },
    ]);
    // The log carries no raw error message (could echo data), only its name.
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).not.toContain("connection reset");
    err.mockRestore();
  });

  it("a drop that is not this vendor's fails every order as not_found", async () => {
    const { run } = fakeTxRunner(null);
    const out = await runBulkStorefrontOrderAction({
      runInTransaction: run,
      vendorId: "v1",
      dropId: "someone-elses",
      orderIds: ["o1", "o2"],
      action: "confirm",
    });
    expect(apply).not.toHaveBeenCalled();
    expect(out.succeeded).toEqual([]);
    expect(out.failed.map((f) => f.error)).toEqual(["not_found", "not_found"]);
  });
});
