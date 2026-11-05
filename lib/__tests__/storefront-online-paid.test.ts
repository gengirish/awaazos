/**
 * When a Razorpay store's seller is told about an order: at placement only if it
 * can't be paid online, and otherwise once, by whichever of verify and the webhook
 * wins markOrderPaid.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  $transaction: vi.fn(),
  markOrderPaid: vi.fn(),
  bumpOrderSignal: vi.fn(),
  notifyVendorInBackground: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findFirst: mocks.findFirst }, $transaction: mocks.$transaction },
}));
vi.mock("@/lib/drops", () => ({ markOrderPaid: mocks.markOrderPaid }));
vi.mock("@/lib/drops-signal", () => ({ bumpOrderSignal: mocks.bumpOrderSignal }));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  notifyVendorInBackground: mocks.notifyVendorInBackground,
}));

import { alertSellerOnlinePaid, alertsAtPlacement } from "@/lib/storefront-online-paid";
import { applyRazorpayPaymentEvent } from "@/lib/storefront-razorpay-webhook";

const WEBHOOK_ROW = { id: "t1", vendorId: "v1", totalPaise: 12000, paymentStatus: "PENDING" };
const ALERT_ROW = { billNumber: "AWZ-1", totalPaise: 12000, dropId: null, orderItems: [{ qty: 2 }, { qty: 1 }] };
const EVENT = {
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 12000, currency: "INR" } } },
};
const SCOPE = { kind: "vendor", vendorId: "v1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({}));
  mocks.findFirst.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("alertsAtPlacement", () => {
  it("waits for the money only on a UPI order at a Razorpay store", () => {
    expect(alertsAtPlacement("UPI", true)).toBe(false);
    expect(alertsAtPlacement("CASH", true)).toBe(true);
    expect(alertsAtPlacement("UPI", false)).toBe(true);
    expect(alertsAtPlacement("CASH", false)).toBe(true);
  });
});

describe("alertSellerOnlinePaid", () => {
  it("moves the board signal and sends one push with no buyer details", async () => {
    mocks.findFirst.mockResolvedValue(ALERT_ROW);
    await alertSellerOnlinePaid("v1", "t1");
    expect(mocks.bumpOrderSignal).toHaveBeenCalledWith("v1");
    expect(mocks.notifyVendorInBackground).toHaveBeenCalledOnce();
    expect(mocks.notifyVendorInBackground.mock.calls[0]![1]).toMatchObject({
      body: "AWZ-1 · ₹120.00 · 3 items",
      tag: "order-AWZ-1",
    });
    // Compound scope, and a select with nothing about the buyer in it.
    const args = mocks.findFirst.mock.calls[0]![0] as { where: unknown; select: Record<string, unknown> };
    expect(args.where).toEqual({ id: "t1", vendorId: "v1" });
    expect(Object.keys(args.select).sort()).toEqual(["billNumber", "dropId", "orderItems", "totalPaise"]);
  });

  it("never fails the caller: the payment is already booked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.findFirst.mockRejectedValue(new Error("db down"));
    await expect(alertSellerOnlinePaid("v1", "t1")).resolves.toBeUndefined();
    expect(mocks.notifyVendorInBackground).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("the webhook alerts once", () => {
  it("when it wins markOrderPaid", async () => {
    mocks.findFirst.mockResolvedValueOnce(WEBHOOK_ROW).mockResolvedValueOnce(ALERT_ROW);
    mocks.markOrderPaid.mockResolvedValue(true);
    await expect(applyRazorpayPaymentEvent(EVENT, SCOPE, "webhook")).resolves.toBe("ack");
    expect(mocks.notifyVendorInBackground).toHaveBeenCalledOnce();
  });

  it("not when verify got there first", async () => {
    mocks.findFirst.mockResolvedValueOnce(WEBHOOK_ROW);
    mocks.markOrderPaid.mockResolvedValue(false);
    await expect(applyRazorpayPaymentEvent(EVENT, SCOPE, "webhook")).resolves.toBe("ack");
    expect(mocks.notifyVendorInBackground).not.toHaveBeenCalled();
    expect(mocks.bumpOrderSignal).not.toHaveBeenCalled();
  });

  it("not on a repeat delivery of an order already paid", async () => {
    mocks.findFirst.mockResolvedValueOnce({ ...WEBHOOK_ROW, paymentStatus: "PAID" });
    await expect(applyRazorpayPaymentEvent(EVENT, SCOPE, "webhook")).resolves.toBe("ack");
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.notifyVendorInBackground).not.toHaveBeenCalled();
  });

  it("not when the amount doesn't match", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.findFirst.mockResolvedValueOnce({ ...WEBHOOK_ROW, totalPaise: 99 });
    await applyRazorpayPaymentEvent(EVENT, SCOPE, "webhook");
    expect(mocks.notifyVendorInBackground).not.toHaveBeenCalled();
  });
});
