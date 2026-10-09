import { describe, expect, it } from "vitest";

import {
  cashChange,
  parseRupeesInput,
  paiseToRupeesInput,
  paymentMethodLabel,
  quickTenderPaise,
} from "@/lib/cash-tender";

describe("quickTenderPaise", () => {
  it("offers the next note multiples above a small bill", () => {
    // ₹40 → ₹50, ₹100, ₹200, ₹500, ₹2000
    expect(quickTenderPaise(4_000)).toEqual([5_000, 10_000, 20_000, 50_000, 200_000]);
  });

  it("dedupes and only offers amounts above the total", () => {
    // ₹130 → 150 (₹50s), 200 (₹100s and ₹200), 500, 2000
    expect(quickTenderPaise(13_000)).toEqual([15_000, 20_000, 50_000, 200_000]);
  });

  it("skips notes the total is already a multiple of", () => {
    // ₹100 → not ₹100 (Exact) and not ₹150; ₹200, ₹500, ₹2000
    expect(quickTenderPaise(10_000)).toEqual([20_000, 50_000, 200_000]);
  });

  it("handles paise in the total and large bills", () => {
    expect(quickTenderPaise(4_050)).toEqual([5_000, 10_000, 20_000, 50_000, 200_000]);
    expect(quickTenderPaise(230_000)).toEqual([240_000, 250_000, 400_000]);
    expect(quickTenderPaise(234_500)).toEqual([235_000, 240_000, 250_000, 400_000]);
    for (const t of quickTenderPaise(230_000)) expect(t).toBeGreaterThan(230_000);
  });

  it("returns nothing for zero or invalid totals", () => {
    expect(quickTenderPaise(0)).toEqual([]);
    expect(quickTenderPaise(-100)).toEqual([]);
    expect(quickTenderPaise(10.5)).toEqual([]);
  });
});

describe("parseRupeesInput", () => {
  it("parses whole and decimal rupees into paise", () => {
    expect(parseRupeesInput("100")).toBe(10_000);
    expect(parseRupeesInput(" 40.5 ")).toBe(4_050);
    expect(parseRupeesInput("40.55")).toBe(4_055);
    expect(parseRupeesInput("1,000")).toBe(100_000);
    expect(parseRupeesInput("12.")).toBe(1_200);
  });

  it("rejects empty, malformed or over-precise input", () => {
    expect(parseRupeesInput("")).toBeNull();
    expect(parseRupeesInput("abc")).toBeNull();
    expect(parseRupeesInput("-5")).toBeNull();
    expect(parseRupeesInput("1.234")).toBeNull();
    expect(parseRupeesInput("1e3")).toBeNull();
  });
});

describe("paiseToRupeesInput", () => {
  it("round-trips through parseRupeesInput", () => {
    for (const p of [0, 5, 4_000, 4_050, 4_055, 200_000]) {
      expect(parseRupeesInput(paiseToRupeesInput(p))).toBe(p);
    }
    expect(paiseToRupeesInput(4_000)).toBe("40");
    expect(paiseToRupeesInput(4_005)).toBe("40.05");
  });
});

describe("cashChange", () => {
  it("returns change when enough was received", () => {
    expect(cashChange(4_000, 10_000)).toEqual({ kind: "change", changePaise: 6_000 });
    expect(cashChange(4_000, 4_000)).toEqual({ kind: "change", changePaise: 0 });
  });

  it("returns the shortfall otherwise", () => {
    expect(cashChange(4_000, 3_000)).toEqual({ kind: "short", shortPaise: 1_000 });
  });
});

describe("paymentMethodLabel", () => {
  it("maps enum values to readable labels", () => {
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("UPI")).toBe("UPI");
    expect(paymentMethodLabel("CARD")).toBe("Card");
    expect(paymentMethodLabel("RAZORPAY_LINK")).toBe("Razorpay link");
  });
});
