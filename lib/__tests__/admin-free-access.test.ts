import { describe, expect, it } from "vitest";

import {
  addMonthsYmd,
  formatYmd,
  freeAccessMaxYmd,
  istTodayYmd,
  parseFreeUntil,
} from "@/lib/admin-free-access";
import { billingAccess } from "@/lib/plan";

// 14 Oct 2026, 10:00 IST.
const NOW = new Date("2026-10-14T04:30:00.000Z");

describe("istTodayYmd", () => {
  it("uses the IST calendar day, not the UTC one", () => {
    // 19:00 UTC on the 13th is 00:30 IST on the 14th.
    expect(istTodayYmd(new Date("2026-10-13T19:00:00.000Z"))).toBe("2026-10-14");
    expect(istTodayYmd(new Date("2026-10-13T18:00:00.000Z"))).toBe("2026-10-13");
  });
});

describe("addMonthsYmd", () => {
  it("adds calendar months", () => {
    expect(addMonthsYmd("2026-10-14", 6)).toBe("2027-04-14");
    expect(addMonthsYmd("2026-10-14", 1)).toBe("2026-11-14");
    expect(addMonthsYmd("2026-10-14", 24)).toBe("2028-10-14");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonthsYmd("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsYmd("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonthsYmd("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("throws on a malformed date", () => {
    expect(() => addMonthsYmd("14/10/2026", 6)).toThrow();
  });
});

describe("formatYmd", () => {
  it("shows DD/MM/YYYY", () => {
    expect(formatYmd("2027-04-14")).toBe("14/04/2027");
  });
});

describe("parseFreeUntil", () => {
  it("returns 23:59 IST on the chosen day", () => {
    const r = parseFreeUntil("2027-04-14", NOW);
    expect(r).toEqual({ ok: true, endsAt: new Date("2027-04-14T18:29:00.000Z") });
  });

  it("accepts today and the furthest allowed day", () => {
    expect(parseFreeUntil("2026-10-14", NOW).ok).toBe(true);
    expect(parseFreeUntil(freeAccessMaxYmd(NOW), NOW).ok).toBe(true);
  });

  it("rejects yesterday, which would lock the store at once", () => {
    expect(parseFreeUntil("2026-10-13", NOW)).toEqual({ ok: false, error: "in_past" });
  });

  it("rejects a day past the limit", () => {
    expect(parseFreeUntil("2028-10-15", NOW)).toEqual({ ok: false, error: "too_far" });
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseFreeUntil("", NOW)).toEqual({ ok: false, error: "invalid_date" });
    expect(parseFreeUntil("14/04/2027", NOW)).toEqual({ ok: false, error: "invalid_date" });
    expect(parseFreeUntil("2027-02-30", NOW)).toEqual({ ok: false, error: "invalid_date" });
  });

  it("the stored instant keeps a locked store on the trial through that day", () => {
    const r = parseFreeUntil(addMonthsYmd(istTodayYmd(NOW), 6), NOW);
    if (!r.ok) throw new Error("expected a valid date");
    const vendor = { plan: "FREE" as const, planExpiresAt: null, trialEndsAt: r.endsAt };
    expect(billingAccess(vendor, NOW).kind).toBe("trial");
    // 23:00 IST on the last day is still free; 00:30 IST the next day is not.
    expect(billingAccess(vendor, new Date("2027-04-14T17:30:00.000Z")).kind).toBe("trial");
    expect(billingAccess(vendor, new Date("2027-04-14T19:00:00.000Z")).kind).toBe("locked");
  });
});
