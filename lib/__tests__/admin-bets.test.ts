import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BET_METRICS,
  BET_METRIC_KEYS,
  betInputSchema,
  betStatus,
  daysLeftLabel,
  formatBps,
  formatMetricValue,
  formatTarget,
  istYmd,
  meetsTarget,
  metricSnapshot,
  parseTargetInput,
  targetToInput,
  toBetOutput,
  ymdToDateOnly,
} from "@/lib/admin-bets";

const DEADLINE = ymdToDateOnly("2026-12-15");
/** An instant in IST, given as "YYYY-MM-DDTHH:MM". */
const ist = (s: string) => new Date(`${s}:00.000+05:30`);
const share = (num: number, den: number) => ({ unit: "percent" as const, num, den });

describe("formatting", () => {
  it("formats basis points with one decimal and no floating point", () => {
    expect(formatBps(3000)).toBe("30.0%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(1)).toBe("0.0%");
    expect(formatBps(10_000)).toBe("100.0%");
  });

  it("formats each unit", () => {
    expect(formatTarget("percent", 3000)).toBe("30.0%");
    expect(formatTarget("count", 1500)).toBe("1,500");
    expect(formatTarget("paise", 12_345_678)).toBe("₹1,23,456.78");
    expect(formatMetricValue(share(5, 40))).toBe("12.5% (5 of 40)");
    expect(formatMetricValue(share(0, 0))).toBe("–");
  });
});

describe("meetsTarget", () => {
  it("is exact at the boundary: 30 of 100 meets 30%, 29 of 100 doesn't", () => {
    expect(meetsTarget(share(30, 100), 3000, "GTE")).toBe(true);
    expect(meetsTarget(share(29, 100), 3000, "GTE")).toBe(false);
    // 1 of 3 = 33.33…% is not "at most 33.33%".
    expect(meetsTarget(share(1, 3), 3333, "LTE")).toBe(false);
    expect(meetsTarget(share(1, 3), 3334, "LTE")).toBe(true);
  });

  it("has no answer for a share with nothing to divide by", () => {
    expect(meetsTarget(share(0, 0), 3000, "GTE")).toBeNull();
  });

  it("compares counts and paise directly", () => {
    expect(meetsTarget({ unit: "count", value: 20 }, 20, "GTE")).toBe(true);
    expect(meetsTarget({ unit: "paise", value: 999_999 }, 1_000_000, "GTE")).toBe(false);
    expect(meetsTarget({ unit: "count", value: 3 }, 5, "LTE")).toBe(true);
  });
});

describe("betStatus", () => {
  const base = { targetValue: 3000, comparator: "GTE" as const, deadline: DEADLINE };

  it("is green when met, whatever the date", () => {
    expect(betStatus({ ...base, value: share(40, 100), now: ist("2026-11-10T10:00") })).toMatchObject({
      tone: "green",
      label: "Target met",
    });
    expect(betStatus({ ...base, value: share(40, 100), now: ist("2026-12-20T10:00") }).tone).toBe("green");
  });

  it("stays amber through the whole deadline day in IST, then turns red", () => {
    const unmet = share(10, 100);
    expect(betStatus({ ...base, value: unmet, now: ist("2026-12-15T23:59") })).toMatchObject({ tone: "amber", daysLeft: 0 });
    expect(betStatus({ ...base, value: unmet, now: ist("2026-12-16T00:00") })).toMatchObject({ tone: "red", daysLeft: -1 });
    // 16/12 00:00 IST is still 15/12 in UTC: the day comes from IST, not UTC.
    expect(ist("2026-12-16T00:00").toISOString().slice(0, 10)).toBe("2026-12-15");
  });

  it("says when there is no data yet", () => {
    expect(betStatus({ ...base, value: share(0, 0), now: ist("2026-11-10T10:00") })).toMatchObject({
      tone: "amber",
      label: "No data yet",
      met: null,
    });
  });

  it("counts days left in IST calendar days", () => {
    expect(betStatus({ ...base, value: share(0, 1), now: ist("2026-12-14T23:30") }).daysLeft).toBe(1);
    expect(daysLeftLabel(36)).toBe("36 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("Deadline is today");
    expect(daysLeftLabel(-3)).toBe("Deadline passed 3 days ago");
  });

  it("reads today's date in IST", () => {
    expect(istYmd(ist("2026-11-10T00:10"))).toBe("2026-11-10");
  });
});

describe("target input", () => {
  it("parses each unit and refuses anything else", () => {
    expect(parseTargetInput("percent", "30")).toBe(3000);
    expect(parseTargetInput("percent", "12.5")).toBe(1250);
    expect(parseTargetInput("percent", "0.05")).toBe(5);
    expect(parseTargetInput("percent", "101")).toBeNull();
    expect(parseTargetInput("percent", "12.555")).toBeNull();
    expect(parseTargetInput("count", "1,500")).toBe(1500);
    expect(parseTargetInput("count", "2.5")).toBeNull();
    expect(parseTargetInput("paise", "25000")).toBe(2_500_000);
    expect(parseTargetInput("paise", "99.99")).toBe(9999);
    expect(parseTargetInput("paise", "abc")).toBeNull();
  });

  it("round-trips through the edit form", () => {
    for (const [unit, v] of [["percent", 3000], ["percent", 1250], ["percent", 5], ["count", 42], ["paise", 9999]] as const) {
      expect(parseTargetInput(unit, targetToInput(unit, v)), `${unit} ${v}`).toBe(v);
    }
    expect(targetToInput("percent", 1250)).toBe("12.5");
  });
});

describe("betInputSchema", () => {
  const valid = {
    title: "Voice billing",
    hypothesis: "Sellers bill by voice.",
    metricKey: "voice_share",
    targetValue: 3000,
    comparator: "GTE",
    deadline: "2026-12-15",
    notes: "",
  };

  it("accepts a bet, defaulting the decision and blanking empty notes", () => {
    expect(betInputSchema.parse(valid)).toMatchObject({ decision: "PENDING", notes: null });
  });

  it("refuses a share over 100%, an unknown metric and impossible dates", () => {
    expect(betInputSchema.safeParse({ ...valid, targetValue: 10_001 }).success).toBe(false);
    expect(betInputSchema.safeParse({ ...valid, metricKey: "vibes" }).success).toBe(false);
    expect(betInputSchema.safeParse({ ...valid, deadline: "2026-02-30" }).success).toBe(false);
    expect(betInputSchema.safeParse({ ...valid, deadline: "15/12/2026" }).success).toBe(false);
    expect(betInputSchema.safeParse({ ...valid, title: "  " }).success).toBe(false);
  });

  it("lets a count go over 10,000", () => {
    expect(betInputSchema.safeParse({ ...valid, metricKey: "paid_bills_7d", targetValue: 25_000 }).success).toBe(true);
  });

  it("checks what the routes send back", () => {
    const out = toBetOutput({
      id: "b1",
      ...betInputSchema.parse(valid),
      deadline: DEADLINE,
      updatedAt: new Date("2026-11-10T05:00:00.000Z"),
    });
    expect(out).toMatchObject({ deadline: "2026-12-15", updatedAt: "2026-11-10T05:00:00.000Z" });
  });
});

describe("metricSnapshot", () => {
  it("maps every metric key from the page's data", () => {
    const snap = metricSnapshot(
      {
        activeSellers: { current: 7, prior: 5 },
        voiceShare: { share: 0.25, voiceBills: 5, paidBills: 20, counterPaidBills: 12 },
        gmvPaise: { current: 1_234_500, prior: 0 },
        instagram: { since: new Date(), orders: 3, paid: 2, storefrontOrdersSince: 8, storefrontOrders: 8 },
      },
      {
        placed: { total: 8, bySource: { instagram: 3, whatsapp: 0, direct: 5, other: 0 } },
        paid: { total: 6, bySource: { instagram: 2, whatsapp: 0, direct: 4, other: 0 } },
      },
    );
    expect(Object.keys(snap).sort()).toEqual([...BET_METRIC_KEYS].sort());
    expect(snap.voice_share).toEqual(share(5, 20));
    expect(snap.voice_share_counter).toEqual(share(5, 12));
    expect(snap.storefront_paid_share).toEqual(share(6, 8));
    expect(snap.gmv_7d).toEqual({ unit: "paise", value: 1_234_500 });
    for (const k of BET_METRIC_KEYS) expect(snap[k].unit).toBe(BET_METRICS[k].unit);
  });
});

describe("seed bet", () => {
  it("is a valid bet: voice share at least 30% by 15/12/2026", () => {
    const dir = path.join(process.cwd(), "prisma", "migrations", "20261112000000_admin_bets_timeline");
    const sql = readFileSync(path.join(dir, "migration.sql"), "utf8");
    // Whitespace-tolerant: a Windows checkout may turn the file's line ends into CRLF.
    expect(sql).toMatch(/'voice_share',\s+3000,\s+'GTE',\s+DATE '2026-12-15'/);
    expect(
      betInputSchema.safeParse({
        title: "Voice billing",
        hypothesis: "Sellers ring up at least 30% of paid bills by voice by 15/12/2026.",
        metricKey: "voice_share",
        targetValue: 3000,
        comparator: "GTE",
        deadline: "2026-12-15",
      }).success,
    ).toBe(true);
  });
});
