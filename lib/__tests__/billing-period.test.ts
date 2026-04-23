import { afterEach, describe, expect, it, vi } from "vitest";

import { formatBillDateYYYYMMDD, getIstMonthStart, getIstTodayStart } from "@/lib/billing-period";

describe("billing-period", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatBillDateYYYYMMDD produces an 8-digit numeric string", () => {
    const s = formatBillDateYYYYMMDD(new Date("2026-04-23T12:00:00.000Z"));
    expect(s).toMatch(/^\d{8}$/);
    expect(s.length).toBe(8);
  });

  it("getIstTodayStart pins IST calendar day to 00:00:00.000Z storage form", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T18:30:00.000Z"));
    const start = getIstTodayStart();
    expect(start.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("getIstMonthStart returns first of current IST month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const start = getIstMonthStart();
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
