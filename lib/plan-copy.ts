/**
 * Marketing copy for the plan we sell — the ONE place tier text lives.
 *
 * Rendered by the landing teaser (`components/marketing/PricingTeaser.tsx`) and
 * the pricing page (`app/(marketing)/pricing/page.tsx`). Numbers are derived
 * from `PLAN_LIMITS`, the price constants and `TRIAL_DAYS` so copy cannot
 * drift from what the gates enforce; `lib/__tests__/plan-copy.test.ts` checks it.
 *
 * Rules:
 * - One offer: a `TRIAL_DAYS`-day free trial with Starter limits, then Starter
 *   monthly or yearly (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md). FREE is not
 *   marketed — it stays in `PLAN_LIMITS` only for vendors who signed up before
 *   the trial existed.
 * - Prices exclude GST (`GST_BPS`); every paid price says "+ GST".
 * - Only advertise what ships. No "staff logins" until invites exist and
 *   `maxStaff` is enforced (TODO.md §2).
 * - Voice is English & Hindi only — te/kn/ta are dormant (`VOICE_LANGUAGES`).
 * - WhatsApp receipts here means wa.me from the vendor's own WhatsApp, which
 *   works on every plan. `PLAN_LIMITS.*.whatsapp` gates the dormant Gupshup
 *   send, not this.
 * - PRO / ENTERPRISE are not sold; they stay off the marketing surface.
 */
import type { Plan } from "@prisma/client";

import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import { subscriptionBasePaise } from "@/lib/subscription";

/** Tiers shown on the marketing surface, in display order. FREE and PRO stay hidden. */
export const MARKETED_PLANS = ["STARTER"] as const satisfies readonly Plan[];
export type MarketedPlan = (typeof MARKETED_PLANS)[number];

export type PlanMarketing = {
  /** Display name, e.g. "Starter". */
  label: string;
  /** "₹299/mo + GST". */
  price: string;
  /** Just the monthly amount: "₹299". */
  amount: string;
  /** Billing period suffix for `amount`. */
  period: "/mo";
  /** Prices exclude GST (`GST_BPS`). */
  taxNote: "+ GST";
  /** "₹2,990/yr + GST". */
  yearlyPrice: string;
  /** Why yearly is worth it: "2 months free". */
  yearlyNote: string;
  /** "30 days free". */
  trial: string;
  /** One line for the landing-page teaser card. */
  teaser: string;
  /** Short tagline above the bullets on the pricing-page card (no numbers — those live in bullets). */
  summary: string;
  /** Feature bullets for the pricing-page card. */
  bullets: string[];
  /** Visually emphasised tier. */
  emphasis: boolean;
};

function billsPerMonth(plan: Plan): string {
  const cap = PLAN_LIMITS[plan].monthlyTxnCap;
  return cap === null ? "Unlimited bills" : `${cap} bills a month`;
}

function analyticsDays(plan: Plan): string {
  return `${PLAN_LIMITS[plan].analyticsDays} days of sales analytics`;
}

const STARTER_MONTHLY_PAISE = subscriptionBasePaise("STARTER", "monthly");
const STARTER_YEARLY_PAISE = subscriptionBasePaise("STARTER", "yearly");
const STARTER_CSV = PLAN_LIMITS.STARTER.csvExport;

/** Whole months of the monthly price that paying yearly saves. */
export const YEARLY_MONTHS_FREE = Math.floor(
  (12 * STARTER_MONTHLY_PAISE - STARTER_YEARLY_PAISE) / STARTER_MONTHLY_PAISE,
);

const starterAmount = formatINRCompact(STARTER_MONTHLY_PAISE);
const trial = `${TRIAL_DAYS} days free`;

export const PLAN_MARKETING: Record<MarketedPlan, PlanMarketing> = {
  STARTER: {
    label: PLAN_LIMITS.STARTER.label,
    amount: starterAmount,
    period: "/mo",
    taxNote: "+ GST",
    price: `${starterAmount}/mo + GST`,
    yearlyPrice: `${formatINRCompact(STARTER_YEARLY_PAISE)}/yr + GST`,
    yearlyNote: `${YEARLY_MONTHS_FREE} months free`,
    trial,
    teaser: `${trial}, no card needed. ${billsPerMonth("STARTER")}, voice billing, UPI QR and WhatsApp receipts.`,
    summary: "Everything a busy counter needs, on one plan.",
    bullets: [
      `${trial} — no card needed`,
      billsPerMonth("STARTER"),
      "Voice billing in English & Hindi",
      "UPI QR on every bill",
      "WhatsApp receipts from your own WhatsApp",
      analyticsDays("STARTER"),
      ...(STARTER_CSV ? ["CSV export of your bills"] : []),
    ],
    emphasis: true,
  },
};
