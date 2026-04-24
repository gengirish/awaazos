import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      groupBy: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getAdminMetrics,
  istDayStart,
  median,
  wowDelta,
} from "@/lib/admin-metrics";

const txn = prisma.transaction as unknown as {
  groupBy: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  aggregate: ReturnType<typeof vi.fn>;
};

describe("istDayStart — IST day boundary math", () => {
  it("returns today's 00:00 IST as a UTC instant when daysAgo = 0", () => {
    // 2026-06-15T18:30:00Z is exactly 2026-06-16T00:00:00 IST.
    // Today's IST midnight (in UTC) is 2026-06-15T18:30:00Z.
    const now = new Date("2026-06-15T18:30:00.000Z");
    const result = istDayStart(0, now);
    expect(result.toISOString()).toBe("2026-06-15T18:30:00.000Z");
  });

  it("rolls back exactly N * 24h regardless of within-day position", () => {
    // 2026-06-16T05:00:00Z is 10:30 IST on 2026-06-16. Today's IST midnight
    // (in UTC) is still 2026-06-15T18:30:00Z.
    const now = new Date("2026-06-16T05:00:00.000Z");
    const today = istDayStart(0, now);
    const sevenAgo = istDayStart(7, now);
    const fourteenAgo = istDayStart(14, now);

    expect(today.toISOString()).toBe("2026-06-15T18:30:00.000Z");
    expect(sevenAgo.toISOString()).toBe("2026-06-08T18:30:00.000Z");
    expect(fourteenAgo.toISOString()).toBe("2026-06-01T18:30:00.000Z");

    // Distances are exactly 7 and 14 days.
    expect(today.getTime() - sevenAgo.getTime()).toBe(7 * 86_400_000);
    expect(today.getTime() - fourteenAgo.getTime()).toBe(14 * 86_400_000);
  });

  it("anchors to IST midnight even right after UTC midnight", () => {
    // 2026-06-16T00:01:00Z = 05:31 IST on 2026-06-16. IST midnight is
    // still 2026-06-15T18:30:00Z (the same IST day as the test above).
    const now = new Date("2026-06-16T00:01:00.000Z");
    expect(istDayStart(0, now).toISOString()).toBe("2026-06-15T18:30:00.000Z");
  });
});

describe("median", () => {
  it("returns 0 for an empty array (no active vendors guard)", () => {
    expect(median([])).toBe(0);
  });

  it("returns the single value for length 1", () => {
    expect(median([3])).toBe(3);
  });

  it("averages the two middle values for even length", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("returns the middle value for odd length", () => {
    expect(median([5, 1, 9])).toBe(5);
  });
});

describe("wowDelta — divide-by-zero guard", () => {
  it("computes positive growth", () => {
    expect(wowDelta(15, 10)).toBeCloseTo(0.5);
  });

  it("computes negative growth", () => {
    expect(wowDelta(8, 10)).toBeCloseTo(-0.2);
  });

  it("returns 0 when both weeks are zero", () => {
    expect(wowDelta(0, 0)).toBe(0);
  });

  it("guards divide-by-zero by clamping the divisor at 1", () => {
    // (10 - 0) / max(0, 1) = 10
    expect(wowDelta(10, 0)).toBe(10);
  });
});

describe("getAdminMetrics — date windows passed to Prisma", () => {
  beforeEach(() => {
    txn.groupBy.mockReset();
    txn.count.mockReset();
    txn.aggregate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries paid bills using IST midnights for both windows", async () => {
    // Pin "now" to 2026-06-16 05:00 IST — IST midnight (in UTC) is 2026-06-15T18:30:00Z.
    const now = new Date("2026-06-16T05:00:00.000Z");

    txn.groupBy
      .mockResolvedValueOnce([
        { vendorId: "v1", _count: { _all: 14 } }, // 14 / 7 = 2.0 bills/day
        { vendorId: "v2", _count: { _all: 7 } }, //  7 / 7 = 1.0 bills/day
      ])
      .mockResolvedValueOnce([{ vendorId: "v1", _count: { _all: 7 } }]);

    txn.count
      .mockResolvedValueOnce(15) // VOICE
      .mockResolvedValueOnce(20); // total paid

    txn.aggregate
      .mockResolvedValueOnce({ _sum: { totalPaise: 250_000 } }) // this week
      .mockResolvedValueOnce({ _sum: { totalPaise: 100_000 } }); // last week

    const metrics = await getAdminMetrics(now);

    expect(metrics.windows.thisWeekStart.toISOString()).toBe(
      "2026-06-08T18:30:00.000Z",
    );
    expect(metrics.windows.lastWeekStart.toISOString()).toBe(
      "2026-06-01T18:30:00.000Z",
    );

    // groupBy #1 (this week): paidAt >= thisWeekStart, no upper bound
    const groupByThis = txn.groupBy.mock.calls[0][0];
    expect(groupByThis.where.paymentStatus).toBe("PAID");
    expect(groupByThis.where.paidAt.gte.toISOString()).toBe(
      "2026-06-08T18:30:00.000Z",
    );
    expect(groupByThis.where.paidAt.lt).toBeUndefined();

    // groupBy #2 (last week): [lastWeekStart, thisWeekStart)
    const groupByLast = txn.groupBy.mock.calls[1][0];
    expect(groupByLast.where.paidAt.gte.toISOString()).toBe(
      "2026-06-01T18:30:00.000Z",
    );
    expect(groupByLast.where.paidAt.lt.toISOString()).toBe(
      "2026-06-08T18:30:00.000Z",
    );

    // count #1 must filter by source = VOICE; count #2 must NOT
    expect(txn.count.mock.calls[0][0].where.source).toBe("VOICE");
    expect(txn.count.mock.calls[1][0].where.source).toBeUndefined();

    expect(metrics.weeklyActiveVendors).toBe(2);
    expect(metrics.billsPerVendorPerDayMedian).toBe(1.5); // median(2.0, 1.0)
    expect(metrics.voiceSuccessRate7d).toBeCloseTo(0.75); // 15 / 20
    expect(metrics.weeklyGmvPaise).toBe(250_000);

    // WoW: vendors 1 → 2 = +100%; gmv 100k → 250k = +150%
    expect(metrics.wowGrowth.activeVendorsWoW).toBeCloseTo(1);
    expect(metrics.wowGrowth.gmvWoW).toBeCloseTo(1.5);
  });

  it("returns 0 for voiceSuccessRate7d when there are no paid bills", async () => {
    const now = new Date("2026-06-16T05:00:00.000Z");
    txn.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    txn.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    txn.aggregate
      .mockResolvedValueOnce({ _sum: { totalPaise: null } })
      .mockResolvedValueOnce({ _sum: { totalPaise: null } });

    const metrics = await getAdminMetrics(now);
    expect(metrics.voiceSuccessRate7d).toBe(0);
    expect(metrics.weeklyGmvPaise).toBe(0);
    expect(metrics.weeklyActiveVendors).toBe(0);
    expect(metrics.billsPerVendorPerDayMedian).toBe(0);
    // WoW with both sides zero → 0
    expect(metrics.wowGrowth.activeVendorsWoW).toBe(0);
    expect(metrics.wowGrowth.gmvWoW).toBe(0);
  });
});
