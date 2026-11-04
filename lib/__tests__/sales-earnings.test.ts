import { describe, expect, it } from "vitest";

import { PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";
import { chargeBasePaise, earningsByMonth, istMonthKey, salesSharePaise, storeEarnings } from "@/lib/sales-earnings";
import { subscriptionChargePaise } from "@/lib/subscription";

const MONTHLY_CHARGE = subscriptionChargePaise("STARTER", "monthly");
const YEARLY_CHARGE = subscriptionChargePaise("STARTER", "yearly");

const charge = (at: string, paymentId: string | null = at, amountPaise = MONTHLY_CHARGE) => ({
  paymentId,
  amountPaise,
  at: new Date(at),
});

describe("chargeBasePaise", () => {
  it("takes GST back out of what Razorpay charges, exactly", () => {
    expect(chargeBasePaise(MONTHLY_CHARGE)).toBe(PLAN_PRICES_PAISE.STARTER);
    expect(chargeBasePaise(YEARLY_CHARGE)).toBe(PLAN_PRICES_YEARLY_PAISE.STARTER);
  });
});

describe("salesSharePaise", () => {
  it("is half the base, in whole paise", () => {
    expect(salesSharePaise(29_900)).toBe(14_950);
    expect(salesSharePaise(299_000)).toBe(149_500);
    expect(salesSharePaise(29_901)).toBe(14_950);
  });
});

describe("storeEarnings", () => {
  it("is null with no real charge", () => {
    expect(storeEarnings([])).toBeNull();
    expect(storeEarnings([charge("2026-11-01T00:00:00Z", "p", 0)])).toBeNull();
  });

  it("counts a payment once, however many events name it", () => {
    const earned = storeEarnings([charge("2026-11-01T00:00:00Z", "pay_1"), charge("2026-11-01T00:05:00Z", "pay_1")]);
    expect(earned?.lines).toHaveLength(1);
  });

  it("keeps charges with no payment id apart", () => {
    const earned = storeEarnings([charge("2026-11-01T00:00:00Z", null), charge("2026-12-01T00:00:00Z", null)]);
    expect(earned?.lines).toHaveLength(2);
  });

  it("stops the share 12 months after the first charge, whatever order they arrive in", () => {
    const earned = storeEarnings([
      charge("2027-11-01T00:00:00Z"),
      charge("2026-11-01T00:00:00Z"),
      charge("2027-10-31T23:59:00Z"),
    ]);
    expect(earned?.firstChargeAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(earned?.shareEndsAt.toISOString()).toBe("2027-11-01T00:00:00.000Z");
    expect(earned?.lines.map((l) => l.at.toISOString())).toEqual([
      "2026-11-01T00:00:00.000Z",
      "2027-10-31T23:59:00.000Z",
    ]);
  });

  it("pays a yearly store once, and not on its renewal", () => {
    const earned = storeEarnings([
      charge("2026-11-01T00:00:00Z", "y1", YEARLY_CHARGE),
      charge("2027-11-01T00:00:00Z", "y2", YEARLY_CHARGE),
    ]);
    expect(earned?.lines.map((l) => l.sharePaise)).toEqual([249_500]);
  });
});

describe("earningsByMonth", () => {
  it("uses the IST month: 31 Oct 19:00 UTC is already November", () => {
    expect(istMonthKey(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
    expect(istMonthKey(new Date("2026-10-31T18:00:00Z"))).toBe("2026-10");
  });

  it("adds up per month, newest first", () => {
    const lines = [
      { at: new Date("2026-10-10T00:00:00Z"), basePaise: 29_900, sharePaise: 14_950 },
      { at: new Date("2026-11-10T00:00:00Z"), basePaise: 29_900, sharePaise: 14_950 },
      { at: new Date("2026-11-11T00:00:00Z"), basePaise: 299_000, sharePaise: 149_500 },
    ];
    expect(earningsByMonth(lines)).toEqual([
      { key: "2026-11", label: "November 2026", basePaise: 328_900, sharePaise: 164_450 },
      { key: "2026-10", label: "October 2026", basePaise: 29_900, sharePaise: 14_950 },
    ]);
  });
});
