/**
 * Admin pricing calculator (/admin/pricing): what a kitchen pays each month
 * under different AwaazOS pricing models, and what AwaazOS would earn.
 *
 * Two different Razorpay bills are modelled, don't mix them up:
 * - The kitchen's own: its Razorpay account collects its buyers' payments and
 *   takes its fees there (standard settlement is free, instant costs extra).
 *   AwaazOS is outside that money path (docs/RAZORPAY_PARTNER_PLAN.md).
 * - AwaazOS's: the platform account collects the subscription and takes a fee
 *   from us, which "AwaazOS revenue" takes off.
 *
 * Internal planning tool — nothing here bills anyone. Real prices live in
 * `PLAN_PRICES_PAISE` / `PLAN_PRICES_YEARLY_PAISE`; they only seed the defaults.
 *
 * Pure and client-safe. Money is integer paise and rates are basis points, so
 * every figure is floored paise (`.cursor/rules/money.mdc`).
 */

import { GST_BPS, PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";

export const PRICING_PLANS = [
  { key: "flat", name: "Flat monthly" },
  { key: "pct", name: "% per order" },
  { key: "capped", name: "% with cap" },
  { key: "annual", name: "Annual prepaid" },
] as const;

export type PricingPlanKey = (typeof PRICING_PLANS)[number]["key"];

export const GATEWAYS = [
  { key: "razorpay", name: "Razorpay", rateBps: 200 },
  { key: "cashfree", name: "Cashfree", rateBps: 195 },
] as const;

export type GatewayKey = (typeof GATEWAYS)[number]["key"];

/**
 * Razorpay's offer to new accounts: no gateway fee for 90 days or the first ₹5L,
 * as published in Nov 2026 (internal brief IF-RES-2026-177). Check it before
 * quoting it.
 */
export const RAZORPAY_NEW_ACCOUNT_OFFER = { months: 3, capPaise: 5_00_000_00 };

export type PricingInputs = {
  salesPaise: number;
  aovPaise: number;
  /** Share of sales paid through the gateway; the rest is direct UPI or cash (no fee). */
  gatewayShareBps: number;
  gatewayRateBps: number;
  /** Instant (T+0) settlement instead of the free standard one (T+2). */
  instantSettlement: boolean;
  /** Charged on the amount settled, before its GST. Set per account by the gateway. */
  instantSettlementBps: number;
  flatPaise: number;
  feeBps: number;
  capPaise: number;
  annualPaise: number;
  /** AwaazOS adds GST to its fee (it does: subscription prices exclude GST). */
  chargeGst: boolean;
  /** Delivery-app commission, for the comparison line only. */
  appCommissionBps: number;
  /** What Razorpay takes from AwaazOS on each subscription charge, before its GST. */
  platformGatewayBps: number;
  /** AwaazOS's partner commission on connected kitchens' gateway volume. */
  partnerCommissionBps: number;
};

export const PRICING_DEFAULTS: PricingInputs = {
  salesPaise: 1_00_000_00,
  aovPaise: 500_00,
  gatewayShareBps: 10_000,
  gatewayRateBps: GATEWAYS[0].rateBps,
  instantSettlement: false,
  instantSettlementBps: 30,
  flatPaise: PLAN_PRICES_PAISE.STARTER,
  feeBps: 100,
  capPaise: PLAN_PRICES_PAISE.STARTER,
  annualPaise: PLAN_PRICES_YEARLY_PAISE.STARTER ?? PLAN_PRICES_PAISE.STARTER * 10,
  chargeGst: true,
  appCommissionBps: 2_500,
  platformGatewayBps: 200,
  partnerCommissionBps: 0,
};

export type Segment = { name: string; kitchens: number; avgSalesPaise: number };

export const DEFAULT_SEGMENTS: Segment[] = [
  { name: "Small", kitchens: 12, avgSalesPaise: 30_000_00 },
  { name: "Mid", kitchens: 6, avgSalesPaise: 75_000_00 },
  { name: "Large", kitchens: 2, avgSalesPaise: 1_50_000_00 },
];

/** `amount × bps / 10 000`, floored. */
export function applyBps(amountPaise: number, bps: number): number {
  return Math.floor((amountPaise * bps) / 10_000);
}

function withGst(paise: number): number {
  return paise + applyBps(paise, GST_BPS);
}

/** AwaazOS's fee before GST for one month at these sales. */
export function awaazosFeePaise(plan: PricingPlanKey, salesPaise: number, c: PricingInputs): number {
  switch (plan) {
    case "flat":
      return salesPaise > 0 ? c.flatPaise : 0;
    case "pct":
      return applyBps(salesPaise, c.feeBps);
    case "capped":
      return Math.min(applyBps(salesPaise, c.feeBps), c.capPaise);
    case "annual":
      return Math.floor(c.annualPaise / 12);
  }
}

/** Gateway fee incl. its GST on the share of sales paid through the gateway. */
export function gatewayFeePaise(salesPaise: number, c: PricingInputs): number {
  const base = Math.floor((salesPaise * c.gatewayShareBps * c.gatewayRateBps) / 100_000_000);
  return withGst(base);
}

function gatewayVolumePaise(salesPaise: number, c: PricingInputs): number {
  return applyBps(salesPaise, c.gatewayShareBps);
}

/** Instant settlement incl. its GST, on what the gateway settles after its own fee. */
export function instantSettlementFeePaise(salesPaise: number, c: PricingInputs): number {
  if (!c.instantSettlement) return 0;
  const settled = gatewayVolumePaise(salesPaise, c) - gatewayFeePaise(salesPaise, c);
  return withGst(applyBps(settled, c.instantSettlementBps));
}

/** Gateway fees incl. GST a new account would not pay during the offer. */
export function newAccountOfferSavingPaise(salesPaise: number, c: PricingInputs): number {
  const volume = Math.min(
    gatewayVolumePaise(salesPaise, c) * RAZORPAY_NEW_ACCOUNT_OFFER.months,
    RAZORPAY_NEW_ACCOUNT_OFFER.capPaise,
  );
  return withGst(applyBps(volume, c.gatewayRateBps));
}

export type KitchenCost = {
  gatewayPaise: number;
  settlementPaise: number;
  feePaise: number;
  feeGstPaise: number;
  totalPaise: number;
};

export function kitchenCost(plan: PricingPlanKey, salesPaise: number, c: PricingInputs): KitchenCost {
  const gatewayPaise = gatewayFeePaise(salesPaise, c);
  const settlementPaise = instantSettlementFeePaise(salesPaise, c);
  const feePaise = awaazosFeePaise(plan, salesPaise, c);
  const feeGstPaise = c.chargeGst ? applyBps(feePaise, GST_BPS) : 0;
  return {
    gatewayPaise,
    settlementPaise,
    feePaise,
    feeGstPaise,
    totalPaise: gatewayPaise + settlementPaise + feePaise + feeGstPaise,
  };
}

/** Delivery-app commission incl. GST on it, for the comparison line. */
export function deliveryAppCostPaise(salesPaise: number, c: PricingInputs): number {
  return withGst(applyBps(salesPaise, c.appCommissionBps));
}

/** `part / whole` in basis points, floored; 0 when `whole` is 0. */
export function shareBps(partPaise: number, wholePaise: number): number {
  return wholePaise > 0 ? Math.floor((partPaise * 10_000) / wholePaise) : 0;
}

/** Orders a month at this average order value (whole orders). */
export function ordersPerMonth(c: PricingInputs): number {
  return c.aovPaise > 0 ? Math.floor(c.salesPaise / c.aovPaise) : 0;
}

/**
 * What Razorpay takes from AwaazOS for collecting this fee, per month. It is
 * charged on the whole amount collected, GST included, and an annual plan is
 * one charge a year.
 */
export function platformGatewayCostPaise(plan: PricingPlanKey, salesPaise: number, c: PricingInputs): number {
  const annual = plan === "annual";
  const fee = annual ? c.annualPaise : awaazosFeePaise(plan, salesPaise, c);
  const collected = c.chargeGst ? withGst(fee) : fee;
  const cost = withGst(applyBps(collected, c.platformGatewayBps));
  return annual ? Math.floor(cost / 12) : cost;
}

export type PlatformRevenue = {
  /** Per segment, per plan (in `PRICING_PLANS` order), AwaazOS's fee before GST. */
  rows: { segment: Segment; byPlan: number[] }[];
  monthlyByPlan: number[];
  /** Razorpay's fee on what AwaazOS collects, per month, per plan. */
  gatewayCostByPlan: number[];
  /** Partner commission per month; the same on every plan. */
  partnerCommissionPaise: number;
  /** Revenue − Razorpay's fee + partner commission, per month, per plan. */
  netMonthlyByPlan: number[];
  gmvPaise: number;
};

export function platformRevenue(segments: Segment[], c: PricingInputs): PlatformRevenue {
  const monthlyByPlan = PRICING_PLANS.map(() => 0);
  const rows = segments.map((segment) => {
    const byPlan = PRICING_PLANS.map((p, i) => {
      const v = segment.kitchens * awaazosFeePaise(p.key, segment.avgSalesPaise, c);
      monthlyByPlan[i] += v;
      return v;
    });
    return { segment, byPlan };
  });
  const gatewayCostByPlan = PRICING_PLANS.map((p) =>
    segments.reduce((sum, s) => sum + s.kitchens * platformGatewayCostPaise(p.key, s.avgSalesPaise, c), 0),
  );
  const partnerCommissionPaise = segments.reduce(
    (sum, s) => sum + s.kitchens * applyBps(gatewayVolumePaise(s.avgSalesPaise, c), c.partnerCommissionBps),
    0,
  );
  const netMonthlyByPlan = monthlyByPlan.map((v, i) => v - (gatewayCostByPlan[i] ?? 0) + partnerCommissionPaise);
  const gmvPaise = segments.reduce((sum, s) => sum + s.kitchens * s.avgSalesPaise, 0);
  return { rows, monthlyByPlan, gatewayCostByPlan, partnerCommissionPaise, netMonthlyByPlan, gmvPaise };
}

/** "1.5" / "25" / "0.25" → basis points, without float parsing. null when not a percentage. */
export function percentToBps(raw: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** "1,499" / "1499" → paise for whole rupees. null when not a whole, non-negative amount. */
export function wholeRupeesToPaise(raw: string): number | null {
  const digits = raw.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(digits)) return null;
  return Number(digits) * 100;
}

/** Whole rupees, paise dropped: "₹2,360". Display only — estimates, not bills. */
export function formatRupees(paise: number): string {
  return formatINRCompact(paise - (paise % 100));
}

/** Basis points as "0.35%". Display only. */
export function formatBps(bps: number): string {
  return `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bps / 100)}%`;
}
