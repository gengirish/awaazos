import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vendor: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    referralReward: { aggregate: vi.fn(), groupBy: vi.fn() },
  },
}));

import {
  buildTopReferrers,
  getReferralMetrics,
  loadRecentReferrals,
  referralRewardStatus,
} from "@/lib/admin-referrals";
import { prisma } from "@/lib/prisma";

const db = prisma as unknown as {
  vendor: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  referralReward: { aggregate: ReturnType<typeof vi.fn> };
};

const stores = [
  { id: "a", name: "Anna's Bakes", slug: "anna" },
  { id: "b", name: "Bina Kitchen", slug: "bina" },
  { id: "c", name: "Chai Point", slug: "chai" },
];

describe("buildTopReferrers", () => {
  it("adds up sign-ups and rewards per referrer and splits redeemed from banked", () => {
    const rows = buildTopReferrers(
      [
        { referrerVendorId: "a", signedUp: 3 },
        { referrerVendorId: "b", signedUp: 1 },
      ],
      [
        { referrerVendorId: "a", status: "REDEEMED", rewards: 1, months: 2 },
        { referrerVendorId: "a", status: "EARNED", rewards: 1, months: 1 },
      ],
      stores,
    );
    expect(rows).toEqual([
      { ...stores[0], signedUp: 3, rewarded: 2, monthsEarned: 3, monthsRedeemed: 2, monthsBanked: 1 },
      { ...stores[1], signedUp: 1, rewarded: 0, monthsEarned: 0, monthsRedeemed: 0, monthsBanked: 0 },
    ]);
  });

  it("sorts by months earned, then sign-ups, then name", () => {
    const rows = buildTopReferrers(
      [
        { referrerVendorId: "a", signedUp: 1 },
        { referrerVendorId: "b", signedUp: 5 },
        { referrerVendorId: "c", signedUp: 5 },
      ],
      [{ referrerVendorId: "a", status: "EARNED", rewards: 1, months: 1 }],
      stores,
    );
    expect(rows.map((r) => r.slug)).toEqual(["anna", "bina", "chai"]);
  });

  it("drops referrers it has no store for (demo or deleted) and stores with nothing", () => {
    const rows = buildTopReferrers(
      [{ referrerVendorId: "demo", signedUp: 9 }],
      [{ referrerVendorId: "demo", status: "EARNED", rewards: 1, months: 1 }],
      stores,
    );
    expect(rows).toEqual([]);
  });

  it("cuts to the limit", () => {
    const rows = buildTopReferrers(
      stores.map((s) => ({ referrerVendorId: s.id, signedUp: 1 })),
      [],
      stores,
      2,
    );
    expect(rows).toHaveLength(2);
  });
});

describe("referralRewardStatus", () => {
  it("labels none, banked and redeemed", () => {
    expect(referralRewardStatus(null)).toBe("None");
    expect(referralRewardStatus({ months: 1, status: "EARNED" })).toBe("Earned 1 month, banked");
    expect(referralRewardStatus({ months: 2, status: "REDEEMED" })).toBe("Redeemed (2 months)");
  });
});

describe("queries", () => {
  beforeEach(() => {
    db.vendor.count.mockReset();
    db.vendor.findMany.mockReset();
    db.referralReward.aggregate.mockReset();
  });

  it("getReferralMetrics counts the last 30 IST days and leaves demo stores out", async () => {
    const now = new Date("2026-06-16T05:00:00.000Z");
    db.vendor.count.mockResolvedValueOnce(4);
    db.referralReward.aggregate.mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { months: 3 } });

    const m = await getReferralMetrics(now);
    expect(m).toMatchObject({ referredSignups: 4, rewardsEarned: 2, rewardMonthsEarned: 3 });
    expect(m.since.toISOString()).toBe("2026-05-16T18:30:00.000Z");

    const countWhere = db.vendor.count.mock.calls[0][0].where;
    expect(countWhere.isDemo).toBe(false);
    expect(countWhere.referredBy).toEqual({ isDemo: false });
    expect(countWhere.createdAt.gte).toEqual(m.since);
    const rewardWhere = db.referralReward.aggregate.mock.calls[0][0].where;
    expect(rewardWhere.referrer).toEqual({ isDemo: false });
    expect(rewardWhere.earnedAt.gte).toEqual(m.since);
  });

  it("loadRecentReferrals is bounded and selects no contact details", async () => {
    db.vendor.findMany.mockResolvedValueOnce([]);
    await loadRecentReferrals(new Date("2026-06-16T05:00:00.000Z"));
    const args = db.vendor.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(args.where.isDemo).toBe(false);
    expect(args.select.phone).toBeUndefined();
    expect(args.select.email).toBeUndefined();
    expect(args.select.trialEndsAt).toBe(true);
    expect(args.select.planExpiresAt).toBe(true);
  });
});
