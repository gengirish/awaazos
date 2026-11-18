import { describe, expect, it } from "vitest";

import { PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";
import {
  PRICING_DEFAULTS,
  awaazosFeePaise,
  deliveryAppCostPaise,
  formatBps,
  formatRupees,
  instantSettlementFeePaise,
  kitchenCost,
  newAccountOfferSavingPaise,
  ordersPerMonth,
  percentToBps,
  platformGatewayCostPaise,
  platformRevenue,
  shareBps,
  wholeRupeesToPaise,
  type PricingInputs,
} from "@/lib/pricing-calculator";
import { BRAND_NAME } from "@/lib/brand";

// Fixed prices, so a change of list price does not move the arithmetic below.
const c: PricingInputs = { ...PRICING_DEFAULTS, flatPaise: 29900, capPaise: 29900, annualPaise: 299000 };

describe("pricing calculator", () => {
  it("defaults to today's STARTER prices with GST on", () => {
    expect(PRICING_DEFAULTS.flatPaise).toBe(PLAN_PRICES_PAISE.STARTER);
    expect(PRICING_DEFAULTS.annualPaise).toBe(PLAN_PRICES_YEARLY_PAISE.STARTER);
    expect(PRICING_DEFAULTS.chargeGst).toBe(true);
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

  it("charges nothing extra for standard settlement", () => {
    const cost = kitchenCost("flat", 1_00_000_00, c);
    expect(cost.settlementPaise).toBe(0);
    expect(cost.totalPaise).toBe(cost.gatewayPaise + cost.feePaise + cost.feeGstPaise);
  });

  it("charges instant settlement on what is settled after the gateway fee", () => {
    const instant = { ...c, instantSettlement: true };
    // ₹100: ₹2.36 gateway, ₹97.64 settled, 0.30% = 29p, + 5p GST.
    expect(instantSettlementFeePaise(100_00, instant)).toBe(34);
    // ₹1L: ₹97,640 settled, ₹292.92 + ₹52.72 GST.
    expect(instantSettlementFeePaise(1_00_000_00, instant)).toBe(345_64);
    expect(instantSettlementFeePaise(1_00_000_00, { ...instant, instantSettlementBps: 20 })).toBe(230_43);

    const cost = kitchenCost("flat", 1_00_000_00, instant);
    expect(cost.settlementPaise).toBe(345_64);
    expect(cost.totalPaise).toBe(2_360_00 + 345_64 + 299_00 + 53_82);
  });

  it("charges instant settlement only on gateway money", () => {
    const instant = { ...c, instantSettlement: true };
    expect(instantSettlementFeePaise(1_00_000_00, { ...instant, gatewayShareBps: 0 })).toBe(0);
    expect(instantSettlementFeePaise(1_00_000_00, { ...instant, gatewayShareBps: 5_000 })).toBe(172_82);
  });

  it("caps the new-account offer at ₹5L of volume over three months", () => {
    expect(newAccountOfferSavingPaise(1_00_000_00, c)).toBe(7_080_00); // 3 × ₹1L at 2.36%
    expect(newAccountOfferSavingPaise(3_00_000_00, c)).toBe(11_800_00); // capped at ₹5L
    expect(newAccountOfferSavingPaise(1_00_000_00, { ...c, gatewayShareBps: 0 })).toBe(0);
  });

  it(`takes Razorpay's fee on the whole amount ${BRAND_NAME} collects`, () => {
    // ₹352.82 charged: 2% = ₹7.05, + ₹1.26 GST.
    expect(platformGatewayCostPaise("flat", 1_00_000_00, c)).toBe(8_31);
    // ₹3,528.20 once a year: 2% = ₹70.56, + ₹12.70 GST = ₹83.26, over 12 months.
    expect(platformGatewayCostPaise("annual", 1_00_000_00, c)).toBe(Math.floor(83_26 / 12));
    expect(platformGatewayCostPaise("flat", 0, c)).toBe(0);
    // Without GST on our fee, only ₹299 is collected: 2% = ₹5.98, + ₹1.07 GST.
    expect(platformGatewayCostPaise("flat", 1_00_000_00, { ...c, chargeGst: false })).toBe(7_05);
  });

  it("nets Razorpay's fee and any partner commission off platform revenue", () => {
    const segments = [{ name: "Mid", kitchens: 2, avgSalesPaise: 1_00_000_00 }];
    const r = platformRevenue(segments, c);
    expect(r.gatewayCostByPlan[0]).toBe(2 * 8_31);
    expect(r.partnerCommissionPaise).toBe(0);
    expect(r.netMonthlyByPlan[0]).toBe(2 * (299_00 - 8_31));

    const withCommission = platformRevenue(segments, { ...c, partnerCommissionBps: 10, gatewayShareBps: 5_000 });
    expect(withCommission.partnerCommissionPaise).toBe(2 * 50_00); // 0.1% of ₹50k, two kitchens
    expect(withCommission.netMonthlyByPlan[0]).toBe(2 * (299_00 - 8_31 + 50_00));
    for (const v of [...r.gatewayCostByPlan, ...r.netMonthlyByPlan]) expect(Number.isInteger(v)).toBe(true);
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
