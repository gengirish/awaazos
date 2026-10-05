import { describe, expect, it } from "vitest";

import {
  dbDateToYmd,
  formatFulfilmentWindow,
  formatIstDate,
  formatIstDayLabel,
  formatIstTime,
  istToUtc,
  utcToIstParts,
  ymdToDbDate,
} from "@/lib/drops-time";

describe("istToUtc", () => {
  it("applies the fixed +05:30 offset", () => {
    expect(istToUtc("2026-10-05", "17:30").toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });

  it("crosses midnight backwards: IST early morning is the previous UTC day", () => {
    expect(istToUtc("2026-10-05", "00:00").toISOString()).toBe("2026-10-04T18:30:00.000Z");
    expect(istToUtc("2026-10-05", "05:29").toISOString()).toBe("2026-10-04T23:59:00.000Z");
    expect(istToUtc("2026-10-05", "05:30").toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("crosses month and year boundaries", () => {
    expect(istToUtc("2026-01-01", "02:00").toISOString()).toBe("2025-12-31T20:30:00.000Z");
    expect(istToUtc("2026-03-01", "00:15").toISOString()).toBe("2026-02-28T18:45:00.000Z");
  });

  it("round-trips with utcToIstParts", () => {
    const pairs: [string, string][] = [
      ["2026-10-05", "00:00"],
      ["2026-10-05", "05:29"],
      ["2026-10-05", "12:00"],
      ["2026-10-05", "23:59"],
      ["2026-12-31", "23:30"],
      ["2028-02-29", "18:45"],
    ];
    for (const [ymd, hm] of pairs) {
      expect(utcToIstParts(istToUtc(ymd, hm))).toEqual({ ymd, hm });
    }
  });

  it.each([
    ["2026-10-5", "17:30"],
    ["2026/10/05", "17:30"],
    ["2026-10-05", "24:00"],
    ["2026-10-05", "7:30"],
    ["2026-10-05", "17:60"],
    ["", ""],
    ["2026-13-01", "10:00"],
    ["2026-02-30", "10:00"], // impossible day must not roll over into March
    ["2027-02-29", "10:00"], // not a leap year
    ["2026-04-31", "10:00"],
  ])("throws on invalid input %s %s", (ymd, hm) => {
    expect(() => istToUtc(ymd, hm)).toThrow(/Invalid/);
  });
});

describe("utcToIstParts", () => {
  it("crosses midnight forwards: late UTC evening is the next IST day", () => {
    expect(utcToIstParts(new Date("2026-10-04T18:30:00.000Z"))).toEqual({ ymd: "2026-10-05", hm: "00:00" });
    expect(utcToIstParts(new Date("2026-12-31T20:00:00.000Z"))).toEqual({ ymd: "2027-01-01", hm: "01:30" });
  });
});

describe("db date helpers", () => {
  it("ymd ⇄ @db.Date round-trips at midnight UTC", () => {
    const d = ymdToDbDate("2026-10-05");
    expect(d.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(dbDateToYmd(d)).toBe("2026-10-05");
  });
  it("rejects malformed and impossible days", () => {
    expect(() => ymdToDbDate("05/10/2026")).toThrow();
    expect(() => ymdToDbDate("2026-02-30")).toThrow();
  });
});

describe("formatting (IST)", () => {
  it("formats DD/MM/YYYY in IST, not UTC", () => {
    expect(formatIstDate(new Date("2026-10-05T12:00:00.000Z"))).toBe("05/10/2026");
    // 20:00 UTC on 4 Oct is already 5 Oct in India
    expect(formatIstDate(new Date("2026-10-04T20:00:00.000Z"))).toBe("05/10/2026");
  });

  it("formats 12h times in IST", () => {
    expect(formatIstTime(new Date("2026-10-05T12:00:00.000Z")).replace(/\s/g, " ").toLowerCase()).toBe("5:30 pm");
    expect(formatIstTime(new Date("2026-10-04T18:30:00.000Z")).replace(/\s/g, " ").toLowerCase()).toBe("12:00 am");
  });

  it("formats day labels and windows", () => {
    const start = istToUtc("2026-10-10", "17:00");
    const end = istToUtc("2026-10-10", "20:00");
    expect(formatIstDayLabel(start)).toBe("Sat, 10 Oct");
    expect(formatFulfilmentWindow(start, end).replace(/\s/g, " ").toLowerCase()).toBe(
      "sat, 10 oct · 5:00 pm – 8:00 pm",
    );
  });
});
