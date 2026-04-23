import { describe, expect, it } from "vitest";

import {
  addIstCalendarDays,
  clampRangeToPlanHistory,
  inclusiveIstDayCount,
  sumDailySummariesKpis,
  voiceAdoptionPercent,
} from "@/lib/analytics-aggregations";
import { getIstTodayStart } from "@/lib/billing-period";

describe("analytics-aggregations", () => {
  it("sumDailySummariesKpis: empty → zeros", () => {
    expect(sumDailySummariesKpis([])).toEqual({
      totalRevenuePaise: 0,
      totalTransactions: 0,
      totalItemsSold: 0,
      cashRevPaise: 0,
      upiRevPaise: 0,
    });
  });

  it("sumDailySummariesKpis: sums three days", () => {
    const rows = [
      {
        totalRevenuePaise: 100,
        totalTransactions: 2,
        totalItemsSold: 3,
        cashRevenuePaise: 40,
        upiRevenuePaise: 60,
      },
      {
        totalRevenuePaise: 200,
        totalTransactions: 1,
        totalItemsSold: 5,
        cashRevenuePaise: 200,
        upiRevenuePaise: 0,
      },
      {
        totalRevenuePaise: 50,
        totalTransactions: 4,
        totalItemsSold: 4,
        cashRevenuePaise: 0,
        upiRevenuePaise: 50,
      },
    ];
    expect(sumDailySummariesKpis(rows)).toEqual({
      totalRevenuePaise: 350,
      totalTransactions: 7,
      totalItemsSold: 12,
      cashRevPaise: 240,
      upiRevPaise: 110,
    });
  });

  it("voiceAdoptionPercent: zero total → 0", () => {
    expect(voiceAdoptionPercent(3, 0)).toBe(0);
  });

  it("voiceAdoptionPercent: rounds to integer percent", () => {
    expect(voiceAdoptionPercent(1, 3)).toBe(33);
    expect(voiceAdoptionPercent(3, 4)).toBe(75);
    expect(voiceAdoptionPercent(10, 10)).toBe(100);
  });

  it("clampRangeToPlanHistory: trims when over cap", () => {
    expect(clampRangeToPlanHistory(60, 30)).toEqual({ days: 30, wasClamped: true });
  });

  it("clampRangeToPlanHistory: no trim when under cap", () => {
    expect(clampRangeToPlanHistory(7, 30)).toEqual({ days: 7, wasClamped: false });
  });

  it("clampRangeToPlanHistory: null cap = unlimited", () => {
    expect(clampRangeToPlanHistory(90, null)).toEqual({ days: 90, wasClamped: false });
  });

  it("inclusiveIstDayCount: single day", () => {
    const d = getIstTodayStart(new Date("2026-04-23T12:00:00.000Z"));
    expect(inclusiveIstDayCount(d, d)).toBe(1);
  });

  it("addIstCalendarDays: moves IST calendar", () => {
    const base = getIstTodayStart(new Date("2026-04-23T12:00:00.000Z"));
    const next = addIstCalendarDays(base, 1);
    expect(inclusiveIstDayCount(base, next)).toBe(2);
  });
});
