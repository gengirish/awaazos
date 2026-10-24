import { describe, expect, it } from "vitest";

import { PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";
import {
  PRICING_DEFAULTS,
  awaazosFeePaise,
  deliveryAppCostPaise,
  formatBps,
  formatRupees,
  kitchenCost,
  ordersPerMonth,
  percentToBps,
  platformRevenue,
  shareBps,
  wholeRupeesToPaise,
  type PricingInputs,
} from "@/lib/pricing-calculator";

const c: PricingInputs = { ...PRICING_DEFAULTS };

describe("pricing calculator", () => {
  it("defaults to today's STARTER prices with GST on", () => {
    expect(c.flatPaise).toBe(PLAN_PRICES_PAISE.STARTER);
    expect(c.annualPaise).toBe(PLAN_PRICES_YEARLY_PAISE.STARTER);
    expect(c.chargeGst).toBe(true);
  });

  it("prices each plan at ₹1L sales", () => {
    const sales = 1_00_000_00;
    expect(awaazosFeePaise("flat", sales, c)).toBe(299_00);
    expect(awaazosFeePaise("pct", sales, c)).toBe(1_000_00);
    expect(awaazosFeePaise("capped", sales, c)).toBe(299_00);
    expect(awaazosFeePaise("annual", sales, c)).toBe(Math.floor(2_990_00 / 12));
  });

  it("charges the flat plan nothing on zero sales", () => {
    expect(awaazosFeePaise("flat", 0, c)).toBe(0);
  });

  it("adds gateway fees and GST in integer paise", () => {
    const cost = kitchenCost("flat", 1_00_000_00, c);
    expect(cost.gatewayPaise).toBe(2_360_00); // 2% of ₹1L + 18% GST
    expect(cost.feeGstPaise).toBe(53_82); // floor(29 900 × 18%)
    expect(cost.totalPaise).toBe(2_360_00 + 299_00 + 53_82);
    for (const v of Object.values(cost)) expect(Number.isInteger(v)).toBe(true);
  });

  it("charges no gateway fee on direct UPI", () => {
    expect(kitchenCost("flat", 1_00_000_00, { ...c, gatewayShareBps: 0 }).gatewayPaise).toBe(0);
    expect(kitchenCost("flat", 1_00_000_00, { ...c, gatewayShareBps: 5_000 }).gatewayPaise).toBe(1_180_00);
  });

  it("leaves GST off the fee when unticked", () => {
    expect(kitchenCost("flat", 1_00_000_00, { ...c, chargeGst: false }).feeGstPaise).toBe(0);
  });

  it("prices the delivery-app comparison with GST on the commission", () => {
    expect(deliveryAppCostPaise(1_00_000_00, c)).toBe(29_500_00);
  });

  it("sums platform revenue per plan", () => {
    const r = platformRevenue(
      [
        { name: "Small", kitchens: 2, avgSalesPaise: 10_000_00 },
        { name: "Large", kitchens: 1, avgSalesPaise: 1_00_000_00 },
      ],
      c,
    );
    expect(r.monthlyByPlan[0]).toBe(3 * 299_00); // flat
    expect(r.monthlyByPlan[1]).toBe(2 * 100_00 + 1_000_00); // 1% per order
    expect(r.monthlyByPlan[2]).toBe(2 * 100_00 + 299_00); // capped
    expect(r.gmvPaise).toBe(1_20_000_00);
  });

  it("parses inputs without floats", () => {
    expect(percentToBps("1")).toBe(100);
    expect(percentToBps("1.5")).toBe(150);
    expect(percentToBps("0.25")).toBe(25);
    expect(percentToBps("101")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
    expect(wholeRupeesToPaise("1,499")).toBe(1_499_00);
    expect(wholeRupeesToPaise("12.5")).toBeNull();
    expect(wholeRupeesToPaise("-1")).toBeNull();
  });

  it("formats shares and rupees for display", () => {
    expect(shareBps(352_82, 1_00_000_00)).toBe(35);
    expect(shareBps(1, 0)).toBe(0);
    expect(formatBps(35)).toBe("0.35%");
    expect(formatRupees(2_360_50)).toBe("₹2,360");
    expect(ordersPerMonth(c)).toBe(200);
  });
});
