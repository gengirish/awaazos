import { describe, expect, it } from "vitest";

import {
  billDayFromYmd,
  dailySummaryReversal,
  parseBillNumber,
  POS_UNDO_SERVER_WINDOW_MS,
  POS_UNDO_TOAST_MS,
  withinUndoWindow,
} from "@/lib/pos-undo";
import { getIstTodayStart } from "@/lib/billing-period";

describe("withinUndoWindow", () => {
  const now = new Date("2026-11-07T10:00:00.000Z");

  it("accepts a sale committed inside the window, refuses older ones", () => {
    expect(withinUndoWindow(new Date(now.getTime() - 5_000), now)).toBe(true);
    expect(withinUndoWindow(new Date(now.getTime() - POS_UNDO_SERVER_WINDOW_MS), now)).toBe(true);
    expect(withinUndoWindow(new Date(now.getTime() - POS_UNDO_SERVER_WINDOW_MS - 1), now)).toBe(false);
  });

  it("tolerates a little clock skew but not a far-future time", () => {
    expect(withinUndoWindow(new Date(now.getTime() + 30_000), now)).toBe(true);
    expect(withinUndoWindow(new Date(now.getTime() + 120_000), now)).toBe(false);
  });

  it("outlasts the toast", () => {
    expect(POS_UNDO_SERVER_WINDOW_MS).toBeGreaterThan(POS_UNDO_TOAST_MS);
  });
});

describe("parseBillNumber / billDayFromYmd", () => {
  it("reads the IST day and sequence back out of a bill number", () => {
    expect(parseBillNumber("AWZ-20261107-0042")).toEqual({ ymd: "20261107", seq: 42 });
    expect(parseBillNumber("AWZ-20261107-12345")).toEqual({ ymd: "20261107", seq: 12345 });
    expect(parseBillNumber("INV-1")).toBeNull();
    expect(parseBillNumber("AWZ-2026117-0001")).toBeNull();
  });

  it("gives the same DailySummary key the sale was booked under", () => {
    // 23:50 IST on 7 Nov is 18:20 UTC: still the 7th.
    const saleAt = new Date("2026-11-07T18:20:00.000Z");
    expect(billDayFromYmd("20261107").getTime()).toBe(getIstTodayStart(saleAt).getTime());
  });
});

describe("dailySummaryReversal", () => {
  it("takes back exactly what the sale added", () => {
    expect(dailySummaryReversal({ totalPaise: 8_000, paymentMethod: "UPI", itemQtys: [2, 1] })).toEqual({
      totalRevenuePaise: 8_000,
      totalTransactions: 1,
      totalItemsSold: 3,
      cashRevenuePaise: 0,
      upiRevenuePaise: 8_000,
    });
    expect(dailySummaryReversal({ totalPaise: 4_000, paymentMethod: "CASH", itemQtys: [2] })).toMatchObject({
      cashRevenuePaise: 4_000,
      upiRevenuePaise: 0,
    });
  });
});
