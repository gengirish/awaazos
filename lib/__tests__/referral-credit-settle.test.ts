/**
 * settleReferralCredit (lib/referral-server.ts): the refund of a paying
 * referrer's charge must never be sent twice, and a refusal must be kept for a
 * retry instead of thrown. Prisma and Razorpay are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Credit = { id: string; paymentId: string; refundPaise: number; status: "PENDING" | "REFUNDED" };

const db = vi.hoisted(() => ({
  credit: null as Credit | null,
  updates: [] as unknown[],
  failed: [] as unknown[],
}));
const rzp = vi.hoisted(() => ({
  refunds: [] as { id: string; notes?: Record<string, string> }[],
  refund: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async () => (db.credit ? [{ id: db.credit.id }] : []),
    referralCredit: {
      findUniqueOrThrow: async () => db.credit,
      update: async (args: unknown) => {
        db.updates.push(args);
        return {};
      },
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      referralCredit: {
        updateMany: async (args: unknown) => {
          db.failed.push(args);
          return { count: 1 };
        },
      },
    },
  };
});
vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      fetchMultipleRefund: async () => ({ items: rzp.refunds }),
      refund: rzp.refund,
    },
  }),
}));

import { settleReferralCredit } from "@/lib/referral-server";

beforeEach(() => {
  db.credit = { id: "cred_1", paymentId: "pay_1", refundPaise: 76_582, status: "PENDING" };
  db.updates = [];
  db.failed = [];
  rzp.refunds = [];
  rzp.refund.mockReset();
});

describe("settleReferralCredit", () => {
  it("refunds the credit's amount once and records the refund", async () => {
    rzp.refund.mockResolvedValue({ id: "rfnd_new" });
    await expect(settleReferralCredit("cred_1")).resolves.toEqual({ kind: "refunded" });
    expect(rzp.refund).toHaveBeenCalledTimes(1);
    expect(rzp.refund).toHaveBeenCalledWith("pay_1", {
      amount: 76_582,
      speed: "normal",
      notes: { referralCreditId: "cred_1", reason: "referral_free_month" },
    });
    expect(db.updates).toMatchObject([
      { where: { id: "cred_1" }, data: { status: "REFUNDED", razorpayRefundId: "rfnd_new" } },
    ]);
  });

  it("records a refund Razorpay already holds instead of refunding again", async () => {
    rzp.refunds = [{ id: "rfnd_other" }, { id: "rfnd_earlier", notes: { referralCreditId: "cred_1" } }];
    await expect(settleReferralCredit("cred_1")).resolves.toEqual({ kind: "refunded" });
    expect(rzp.refund).not.toHaveBeenCalled();
    expect(db.updates).toMatchObject([{ data: { razorpayRefundId: "rfnd_earlier" } }]);
  });

  it("does nothing for a credit already refunded", async () => {
    db.credit = { id: "cred_1", paymentId: "pay_1", refundPaise: 76_582, status: "REFUNDED" };
    await expect(settleReferralCredit("cred_1")).resolves.toEqual({ kind: "refunded" });
    expect(rzp.refund).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("keeps a refusal for a retry and does not throw", async () => {
    rzp.refund.mockRejectedValue({ error: { description: "Your account does not have enough balance" } });
    await expect(settleReferralCredit("cred_1")).resolves.toEqual({
      kind: "failed",
      error: "Your account does not have enough balance",
    });
    expect(db.failed).toMatchObject([
      { where: { id: "cred_1", status: "PENDING" }, data: { lastError: "Your account does not have enough balance" } },
    ]);
  });

  it("reports an unknown credit", async () => {
    db.credit = null;
    await expect(settleReferralCredit("nope")).resolves.toEqual({ kind: "not_found" });
  });
});
