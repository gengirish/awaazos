import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getAdminMetrics, istDayStart, median } from "@/lib/admin-metrics";

const txn = prisma.transaction as unknown as {
  groupBy: ReturnType<typeof vi.fn>;
  aggregate: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

describe("istDayStart — IST day boundary math", () => {
  it("returns today's 00:00 IST as a UTC instant when daysAgo = 0", () => {
    // 2026-06-15T18:30:00Z is exactly 2026-06-16T00:00:00 IST.
    const now = new Date("2026-06-15T18:30:00.000Z");
    expect(istDayStart(0, now).toISOString()).toBe("2026-06-15T18:30:00.000Z");
  });

  it("rolls back exactly N * 24h regardless of within-day position", () => {
    // 2026-06-16T05:00:00Z is 10:30 IST on 2026-06-16.
    const now = new Date("2026-06-16T05:00:00.000Z");
    const today = istDayStart(0, now);
    expect(today.toISOString()).toBe("2026-06-15T18:30:00.000Z");
    expect(istDayStart(7, now).toISOString()).toBe("2026-06-08T18:30:00.000Z");
    expect(istDayStart(14, now).toISOString()).toBe("2026-06-01T18:30:00.000Z");
    expect(today.getTime() - istDayStart(7, now).getTime()).toBe(7 * 86_400_000);
  });

  it("anchors to IST midnight even right after UTC midnight", () => {
    // 2026-06-16T00:01:00Z = 05:31 IST on 2026-06-16.
    const now = new Date("2026-06-16T00:01:00.000Z");
    expect(istDayStart(0, now).toISOString()).toBe("2026-06-15T18:30:00.000Z");
  });
});

describe("median", () => {
  it("handles empty, single, even and odd inputs", () => {
    expect(median([])).toBe(0);
    expect(median([3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([5, 1, 9])).toBe(5);
  });
});

/** 09/11/2026 10:30 IST: this week is 02/11–08/11 IST, today is 09/11. */
const NOW = new Date("2026-11-09T05:00:00.000Z");
const TODAY_START = "2026-11-08T18:30:00.000Z";
const WEEK_START = "2026-11-01T18:30:00.000Z";
const LAST_WEEK_START = "2026-10-25T18:30:00.000Z";

function mockDb({
  paidRows = [] as { paidAt: Date; source: string }[],
  storefrontRows = [] as { createdAt: Date; orderChannel: string | null; paymentStatus: string }[],
  thisWeekSellers = [] as { vendorId: string; _count: { _all: number } }[],
  lastWeekSellers = [] as { vendorId: string; _count: { _all: number } }[],
  sums = { thisWeek: null as number | null, lastWeek: null as number | null, today: 0, todayCount: 0 },
} = {}) {
  txn.groupBy.mockResolvedValueOnce(thisWeekSellers).mockResolvedValueOnce(lastWeekSellers);
  txn.aggregate
    .mockResolvedValueOnce({ _sum: { totalPaise: sums.thisWeek } })
    .mockResolvedValueOnce({ _sum: { totalPaise: sums.lastWeek } })
    .mockResolvedValueOnce({ _sum: { totalPaise: sums.today }, _count: { _all: sums.todayCount } });
  txn.findMany.mockResolvedValueOnce(paidRows).mockResolvedValueOnce(storefrontRows);
}

describe("getAdminMetrics", () => {
  beforeEach(() => {
    txn.groupBy.mockReset();
    txn.aggregate.mockReset();
    txn.findMany.mockReset();
  });

  it("compares the last 7 complete IST days with the 7 before, and keeps today apart", async () => {
    mockDb({
      thisWeekSellers: [
        { vendorId: "v1", _count: { _all: 14 } },
        { vendorId: "v2", _count: { _all: 7 } },
      ],
      lastWeekSellers: [{ vendorId: "v1", _count: { _all: 7 } }],
      sums: { thisWeek: 380_715, lastWeek: 11_000, today: 5_000, todayCount: 2 },
    });

    const m = await getAdminMetrics(NOW);

    expect(m.windows.todayStart.toISOString()).toBe(TODAY_START);
    expect(m.windows.thisWeekStart.toISOString()).toBe(WEEK_START);
    expect(m.windows.lastWeekStart.toISOString()).toBe(LAST_WEEK_START);

    const thisWeek = txn.groupBy.mock.calls[0][0].where;
    expect(thisWeek.paymentStatus).toBe("PAID");
    expect(thisWeek.isSample).toBe(false);
    expect(thisWeek.vendor).toEqual({ isDemo: false });
    expect(thisWeek.paidAt.gte.toISOString()).toBe(WEEK_START);
    expect(thisWeek.paidAt.lt.toISOString()).toBe(TODAY_START);
    const lastWeek = txn.groupBy.mock.calls[1][0].where;
    expect(lastWeek.paidAt.gte.toISOString()).toBe(LAST_WEEK_START);
    expect(lastWeek.paidAt.lt.toISOString()).toBe(WEEK_START);
    const today = txn.aggregate.mock.calls[2][0].where;
    expect(today.paidAt.gte.toISOString()).toBe(TODAY_START);
    expect(today.paidAt.lt).toBeUndefined();

    expect(m.activeSellers).toEqual({ current: 2, prior: 1 });
    expect(m.billsPerSellerPerDayMedian).toBe(1.5); // median(14/7, 7/7)
    expect(m.gmvPaise).toEqual({ current: 380_715, prior: 11_000 });
    expect(m.today).toEqual({ paidBills: 2, gmvPaise: 5_000 });
  });

  it("computes voice share over all paid bills and buckets them by IST day", async () => {
    mockDb({
      paidRows: [
        // 03/11 11:30 IST
        { paidAt: new Date("2026-11-03T06:00:00.000Z"), source: "VOICE" },
        // 08/11 23:59 IST — last minute of the window, still 08/11
        { paidAt: new Date("2026-11-08T18:29:00.000Z"), source: "MANUAL" },
        // 02/11 00:00 IST — first instant of the window
        { paidAt: new Date(WEEK_START), source: "MANUAL" },
        { paidAt: new Date("2026-11-05T06:00:00.000Z"), source: "STOREFRONT" },
      ],
    });

    const m = await getAdminMetrics(NOW);

    expect(m.voiceShare).toEqual({ share: 0.25, voiceBills: 1, paidBills: 4, counterPaidBills: 3 });
    expect(m.days.map((d) => d.day)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(m.days[0].counts.counterPaidBills).toBe(1);
    expect(m.days[1].counts.voiceBills).toBe(1);
    expect(m.days[3].counts.counterPaidBills).toBe(0); // storefront bills are not counter bills
    expect(m.days[6].counts.counterPaidBills).toBe(1);
    expect(m.tripwires.find((t) => t.id === "voice")?.status).toBe("clear");
  });

  it("counts Instagram orders only from when orderChannel was first written", async () => {
    mockDb({
      storefrontRows: [
        // 03/11, before tracking began: in the 7-day total, never in the Instagram count
        { createdAt: new Date("2026-11-03T06:00:00.000Z"), orderChannel: null, paymentStatus: "PAID" },
        { createdAt: new Date("2026-11-06T10:00:00.000Z"), orderChannel: "instagram", paymentStatus: "PAID" },
        { createdAt: new Date("2026-11-07T10:00:00.000Z"), orderChannel: "instagram", paymentStatus: "PENDING" },
        { createdAt: new Date("2026-11-07T11:00:00.000Z"), orderChannel: null, paymentStatus: "PENDING" },
      ],
    });

    const m = await getAdminMetrics(NOW);

    expect(m.instagram).toEqual({
      since: new Date("2026-11-04T07:06:00.000Z"),
      orders: 2,
      paid: 1,
      storefrontOrdersSince: 3,
      storefrontOrders: 4,
    });
    const where = txn.findMany.mock.calls[1][0].where;
    expect(where.source).toBe("STOREFRONT");
    expect(where.createdAt.lt.toISOString()).toBe(TODAY_START);
    expect(m.days[5].counts).toMatchObject({ storefrontOrders: 2, instagramOrders: 1 });
    // 05/11–08/11 are the only fully tracked days: not enough for the check yet.
    expect(m.tripwires.find((t) => t.id === "instagram")).toMatchObject({ status: "waiting", trackedDays: 4 });
  });

  it("fires the voice tripwire when 7 days of counter bills have none by voice", async () => {
    mockDb({
      paidRows: Array.from({ length: 7 }, (_, i) => ({
        paidAt: new Date(new Date(WEEK_START).getTime() + i * 86_400_000 + 3_600_000),
        source: "MANUAL",
      })),
    });
    const m = await getAdminMetrics(NOW);
    expect(m.voiceShare.share).toBe(0);
    expect(m.tripwires.find((t) => t.id === "voice")?.status).toBe("fired");
  });

  it("returns zeros, not NaN, for an empty platform", async () => {
    mockDb();
    const m = await getAdminMetrics(NOW);
    expect(m.activeSellers).toEqual({ current: 0, prior: 0 });
    expect(m.billsPerSellerPerDayMedian).toBe(0);
    expect(m.voiceShare.share).toBe(0);
    expect(m.gmvPaise).toEqual({ current: 0, prior: 0 });
    expect(m.tripwires.every((t) => t.status !== "fired")).toBe(true);
  });
});
