import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorRole: vi.fn(),
  findSettings: vi.fn(),
  upsertSettings: vi.fn(),
  fetchSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  createSubscription: vi.fn(),
  resolvePlanId: vi.fn(),
  redeem: vi.fn(),
}));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { AuthError, requireVendorRole: mocks.requireVendorRole };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { vendorSettings: { findUnique: mocks.findSettings, upsert: mocks.upsertSettings } },
}));
vi.mock("@/lib/razorpay", () => ({
  cancelSubscription: mocks.cancelSubscription,
  createSubscription: mocks.createSubscription,
  fetchSubscription: mocks.fetchSubscription,
  getRazorpayKeyId: () => "rzp_test_key",
}));
vi.mock("@/lib/ratelimit", () => ({
  billingRateLimit: { check: async () => ({ ok: true }) },
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/custom-subscription-plan", () => ({ resolveSubscriptionPlanId: mocks.resolvePlanId }));
vi.mock("@/lib/referral-server", () => ({ redeemBankedRewardsAtSubscribe: mocks.redeem }));

import { POST } from "@/app/api/razorpay/create-subscription/route";

function post(plan: string) {
  return POST(
    new NextRequest("http://test.local/api/razorpay/create-subscription", {
      method: "POST",
      body: JSON.stringify({ plan, interval: "monthly" }),
    }),
  );
}

function asVendor(access: unknown, customPricePaise: number | null = null) {
  mocks.requireVendorRole.mockResolvedValue({
    vendor: { id: "v1", isDemo: false, customPricePaise, trialEndsAt: null },
    access,
    setVendorCookie: null,
  });
}

const PAID_LITE = { kind: "paid", plan: "LITE" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePlanId.mockResolvedValue("plan_new");
  mocks.redeem.mockResolvedValue(null);
  mocks.createSubscription.mockResolvedValue({ subscriptionId: "sub_new", shortUrl: "https://rzp/new" });
  mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "active" });
  mocks.fetchSubscription.mockResolvedValue({ id: "sub_old", status: "active", plan_id: "plan_lite" });
  mocks.cancelSubscription.mockResolvedValue({});
});

describe("create-subscription with three plans", () => {
  it("moving up cancels the live subscription at once, before making the new one", async () => {
    asVendor(PAID_LITE);

    const res = await post("STARTER");

    expect(res.status).toBe(200);
    expect(mocks.cancelSubscription).toHaveBeenCalledWith("sub_old", false);
    expect(mocks.cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSubscription.mock.invocationCallOrder[0],
    );
    expect(mocks.upsertSettings.mock.calls[0][0].update.razorpaySubId).toBe("sub_new");
  });

  it("a failed cancel creates nothing, so the seller can't be charged twice", async () => {
    asVendor(PAID_LITE);
    mocks.cancelSubscription.mockRejectedValue(new Error("razorpay down"));

    const res = await post("STARTER");

    expect(res.status).toBe(500);
    expect(mocks.createSubscription).not.toHaveBeenCalled();
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("creates nothing when the live subscription can't be read", async () => {
    asVendor(PAID_LITE);
    mocks.fetchSubscription.mockRejectedValue(new Error("timeout"));

    const res = await post("PRO");

    expect(res.status).toBe(503);
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  it("moving down or sideways is refused and cancels nothing", async () => {
    asVendor({ kind: "paid", plan: "STARTER" });

    for (const plan of ["LITE", "STARTER"]) {
      expect((await post(plan)).status).toBe(400);
    }
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });

  it("a trial store with a subscription about to start can't open a second one", async () => {
    asVendor({ kind: "trial", endsAt: new Date(Date.now() + 86_400_000) });
    mocks.fetchSubscription.mockResolvedValue({ id: "sub_old", status: "authenticated", plan_id: "plan_lite" });
    mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "authenticated" });

    expect((await post("STARTER")).status).toBe(400);
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  describe("cancelled, still inside the paid period", () => {
    const PAID_STARTER = { kind: "paid", plan: "STARTER" };
    const paidUntil = new Date(Date.now() + 5 * 86_400_000);

    function cancelledAtEnd(customPricePaise: number | null = null) {
      mocks.requireVendorRole.mockResolvedValue({
        vendor: { id: "v1", isDemo: false, customPricePaise, trialEndsAt: null, planExpiresAt: paidUntil },
        access: PAID_STARTER,
        setVendorCookie: null,
      });
      mocks.findSettings.mockResolvedValue({
        razorpaySubId: "sub_old",
        razorpaySubStatus: "active",
        razorpaySubCancelAtEnd: true,
      });
    }

    it("the same plan starts when the period ends, without cancelling the old sub again", async () => {
      cancelledAtEnd(29_900);

      const res = await post("STARTER");

      expect(res.status).toBe(200);
      expect(mocks.cancelSubscription).not.toHaveBeenCalled();
      expect(mocks.createSubscription.mock.calls[0][0]).toMatchObject({
        plan: "STARTER",
        startAt: paidUntil,
        resumesPaidPeriod: true,
      });
      expect(mocks.upsertSettings.mock.calls[0][0].update).toMatchObject({
        razorpaySubId: "sub_new",
        razorpaySubStatus: "created",
        razorpaySubCancelAtEnd: false,
      });
    });

    it("a lower plan also waits for the period's end", async () => {
      cancelledAtEnd();

      expect((await post("LITE")).status).toBe(200);
      expect(mocks.createSubscription.mock.calls[0][0]).toMatchObject({ plan: "LITE", startAt: paidUntil });
    });

    it("a higher plan starts today", async () => {
      cancelledAtEnd();

      expect((await post("PRO")).status).toBe(200);
      expect(mocks.cancelSubscription).not.toHaveBeenCalled();
      expect(mocks.createSubscription.mock.calls[0][0]).toMatchObject({
        plan: "PRO",
        startAt: null,
        resumesPaidPeriod: false,
      });
    });

    it("a second tap reuses the unpaid checkout instead of making another", async () => {
      cancelledAtEnd();
      mocks.findSettings.mockResolvedValue({
        razorpaySubId: "sub_pending",
        razorpaySubStatus: "created",
        razorpaySubCancelAtEnd: false,
      });
      mocks.fetchSubscription.mockResolvedValue({
        id: "sub_pending",
        status: "created",
        plan_id: "plan_new",
        start_at: Math.floor(paidUntil.getTime() / 1000),
        short_url: "https://rzp/pending",
      });

      const res = await post("STARTER");

      expect(await res.json()).toMatchObject({ subscriptionId: "sub_pending" });
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });

    it("once the new one is authenticated, a second is refused", async () => {
      cancelledAtEnd();
      mocks.findSettings.mockResolvedValue({
        razorpaySubId: "sub_new",
        razorpaySubStatus: "authenticated",
        razorpaySubCancelAtEnd: false,
      });
      mocks.fetchSubscription.mockResolvedValue({ id: "sub_new", status: "authenticated", plan_id: "plan_new" });

      expect((await post("STARTER")).status).toBe(400);
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });
  });

  describe("the stored status and Razorpay disagree", () => {
    const TRIAL = { kind: "trial", endsAt: new Date(Date.now() + 86_400_000) };

    it("a live sub whose webhook we missed still blocks a second one", async () => {
      asVendor(TRIAL);
      mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "created" });

      expect((await post("STARTER")).status).toBe(400);
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });

    it("Razorpay unreachable: the stored live status still blocks", async () => {
      asVendor(TRIAL);
      mocks.fetchSubscription.mockRejectedValue(new Error("timeout"));

      expect((await post("STARTER")).status).toBe(400);
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });

    it("a sub Razorpay has ended no longer blocks, even if the stored status says active", async () => {
      asVendor(TRIAL);
      mocks.fetchSubscription.mockResolvedValue({ id: "sub_old", status: "cancelled", plan_id: "plan_lite" });

      expect((await post("STARTER")).status).toBe(200);
      expect(mocks.createSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("a halted subscription can charge again", () => {
    const LOCKED = { kind: "locked", since: new Date(Date.now() - 86_400_000) };

    it("is cancelled before the new one is made", async () => {
      asVendor(LOCKED);
      mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "halted" });
      mocks.fetchSubscription.mockResolvedValue({ id: "sub_old", status: "halted", plan_id: "plan_lite" });

      expect((await post("STARTER")).status).toBe(200);
      expect(mocks.cancelSubscription).toHaveBeenCalledWith("sub_old", false);
      expect(mocks.cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.createSubscription.mock.invocationCallOrder[0],
      );
    });

    it("if it can't be read, nothing new is made", async () => {
      asVendor(LOCKED);
      mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "halted" });
      mocks.fetchSubscription.mockRejectedValue(new Error("timeout"));

      expect((await post("STARTER")).status).toBe(503);
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });

    it("if it can't be cancelled, nothing new is made", async () => {
      asVendor(LOCKED);
      mocks.findSettings.mockResolvedValue({ razorpaySubId: "sub_old", razorpaySubStatus: "halted" });
      mocks.fetchSubscription.mockResolvedValue({ id: "sub_old", status: "halted", plan_id: "plan_lite" });
      mocks.cancelSubscription.mockRejectedValue(new Error("razorpay down"));

      expect((await post("STARTER")).status).toBe(500);
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });
  });

  it("a store with its own price can only buy Starter", async () => {
    asVendor({ kind: "trial", endsAt: new Date(Date.now() + 86_400_000) }, 14900);
    mocks.findSettings.mockResolvedValue({ razorpaySubId: null, razorpaySubStatus: null });

    expect((await post("LITE")).status).toBe(400);
    expect((await post("PRO")).status).toBe(400);
    expect((await post("STARTER")).status).toBe(200);
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1);
  });
});
