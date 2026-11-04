/**
 * Marketing copy for the plan we sell — the ONE place tier text lives.
 *
 * Rendered by the landing teaser (`components/marketing/PricingTeaser.tsx`) and
 * the pricing page (`app/(marketing)/pricing/page.tsx`). Numbers are derived
 * from `PLAN_LIMITS`, the price constants and `TRIAL_DAYS` so copy cannot
 * drift from what the gates enforce; `lib/__tests__/plan-copy.test.ts` checks it.
 *
 * Rules:
 * - A `TRIAL_DAYS`-day free trial with Starter limits, then Lite, Starter or Pro,
 *   monthly or yearly (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md). FREE is not
 *   marketed — it stays in `PLAN_LIMITS` only for vendors who signed up before
 *   the trial existed.
 * - Starter is the plan we want chosen (the decoy effect). Lite sits just under
 *   its price with far less, and Pro well above it with little more. All three
 *   are real plans and the copy states their limits plainly. Everything else on
 *   the marketing surface (the trial, `cta`, `ctaNote`) quotes Starter.
 * - Prices exclude GST (`GST_BPS`); every paid price says "+ GST".
 * - Only advertise what ships. No "staff logins" until invites exist and
 *   `maxStaff` is enforced (TODO.md §2).
 * - Lead with pre-orders (store link, drops, UPI, the orders board): the
 *   customer is an Instagram home kitchen (docs/ICP.md). Counter billing is
 *   one line, not the pitch.
 * - Voice is English & Hindi only — te/kn/ta are dormant (`VOICE_LANGUAGES`).
 * - `cta` is the ONE sign-up label on the marketing and sign-up surfaces.
 * - ENTERPRISE is not sold; it stays off the marketing surface.
 */
import type { Plan } from "@prisma/client";

import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import { subscriptionBasePaise } from "@/lib/subscription";

/** Tiers shown on the marketing surface, in display order. FREE and PRO stay hidden. */
export const MARKETED_PLANS = ["LITE", "STARTER", "PRO"] as const satisfies readonly Plan[];
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
  /** The one sign-up call to action: "Start 30 days free". */
  cta: string;
  /** Line shown beside the CTA: "No card needed. Then ₹299/month + GST." */
  ctaNote: string;
  /** One line for the landing-page teaser card. */
  teaser: string;
  /** Short tagline above the bullets on the pricing-page card (no numbers — those live in bullets). */
  summary: string;
  /** Feature bullets for the pricing-page card. */
  bullets: string[];
  /** Visually emphasised tier. */
  emphasis: boolean;
  /** Short label on the emphasised tier's card. */
  badge: string | null;
};

function billsPerMonth(plan: Plan): string {
  const cap = PLAN_LIMITS[plan].monthlyTxnCap;
  return cap === null ? "Unlimited orders and bills" : `${cap} orders and bills a month`;
}

function analyticsDays(plan: Plan): string {
  return `${PLAN_LIMITS[plan].analyticsDays} days of sales analytics`;
}

const STARTER_MONTHLY_PAISE = subscriptionBasePaise("STARTER", "monthly");
const STARTER_YEARLY_PAISE = subscriptionBasePaise("STARTER", "yearly");
const STARTER_CSV = PLAN_LIMITS.STARTER.csvExport;

function amountOf(plan: MarketedPlan): string {
  return formatINRCompact(subscriptionBasePaise(plan, "monthly"));
}

/** The fields every tier words the same way. */
function priceCopy(plan: MarketedPlan) {
  const amount = amountOf(plan);
  return {
    label: PLAN_LIMITS[plan].label,
    amount,
    period: "/mo" as const,
    taxNote: "+ GST" as const,
    price: `${amount}/mo + GST`,
    yearlyPrice: `${formatINRCompact(subscriptionBasePaise(plan, "yearly"))}/yr + GST`,
    yearlyNote: `${YEARLY_MONTHS_FREE} months free`,
    trial,
    cta: `Start ${trial}`,
    ctaNote: `No card needed. Then ${amount}/month + GST.`,
  };
}

/** Whole months of the monthly price that paying yearly saves. */
export const YEARLY_MONTHS_FREE = Math.floor(
  (12 * STARTER_MONTHLY_PAISE - STARTER_YEARLY_PAISE) / STARTER_MONTHLY_PAISE,
);

const trial = `${TRIAL_DAYS} days free`;

export const PLAN_MARKETING: Record<MarketedPlan, PlanMarketing> = {
  LITE: {
    ...priceCopy("LITE"),
    teaser: `For your first few orders: ${billsPerMonth("LITE").toLowerCase()}, UPI or pay on delivery, and ${analyticsDays("LITE")}.`,
    summary: "The basics, for a store just starting out.",
    bullets: [
      "Your own store link for your Instagram bio and WhatsApp",
      "Drops with a cut-off and stock limits",
      "UPI payments you confirm, or pay on delivery",
      "One orders board, a prep sheet and order alerts on your phone",
      "Receipts you send from your own WhatsApp",
      billsPerMonth("LITE"),
      analyticsDays("LITE"),
    ],
    emphasis: false,
    badge: null,
  },
  STARTER: {
    ...priceCopy("STARTER"),
    teaser: `${trial}, no card needed. Your store link, drops with a cut-off, UPI orders on one board, receipts on WhatsApp, and ${billsPerMonth("STARTER").toLowerCase()}.`,
    summary: "Everything a home business needs to take orders and get paid.",
    bullets: [
      `${trial} — no card needed`,
      "Your own store link for your Instagram bio and WhatsApp",
      "Drops with a cut-off and stock limits, so you never oversell",
      "Online payments into your own Razorpay account, marked paid by themselves",
      "UPI payments you confirm, or pay on delivery",
      "One orders board, a prep sheet and order alerts on your phone",
      "Receipts you send from your own WhatsApp",
      billsPerMonth("STARTER"),
      "Counter billing by voice in English & Hindi, even offline",
      analyticsDays("STARTER"),
      ...(STARTER_CSV ? ["CSV export of your bills"] : []),
    ],
    emphasis: true,
    badge: "Best value",
  },
  PRO: {
    ...priceCopy("PRO"),
    teaser: `Everything in ${PLAN_LIMITS.STARTER.label}, with ${analyticsDays("PRO")}.`,
    summary: "For a store that wants its whole year in one place.",
    bullets: [`Everything in ${PLAN_LIMITS.STARTER.label}`, billsPerMonth("PRO"), analyticsDays("PRO")],
    emphasis: false,
    badge: null,
  },
};
