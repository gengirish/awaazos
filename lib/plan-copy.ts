/**
 * Marketing copy for the plans we sell — the ONE place tier text lives.
 *
 * Rendered by the landing teaser (`components/marketing/PricingTeaser.tsx`) and
 * the pricing page (`app/(marketing)/pricing/page.tsx`). Numbers are derived
 * from `PLAN_LIMITS` so copy cannot drift from what the gates enforce;
 * `lib/__tests__/plan-copy.test.ts` checks it.
 *
 * Rules:
 * - Only advertise what ships. No "staff logins" until invites exist and
 *   `maxStaff` is enforced (TODO.md §2).
 * - Voice is English & Hindi only — te/kn/ta are dormant (`VOICE_LANGUAGES`).
 * - WhatsApp receipts here means wa.me from the vendor's own WhatsApp, which
 *   works on every plan. `PLAN_LIMITS.*.whatsapp` gates the dormant Gupshup
 *   send, not this.
 * - PRO / ENTERPRISE are not sold; they stay off the marketing surface.
 */
import type { Plan } from "@prisma/client";

import { PLAN_LIMITS, PLAN_PRICES_PAISE } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";

/** Tiers shown on the marketing surface, in display order. PRO stays hidden. */
export const MARKETED_PLANS = ["FREE", "STARTER"] as const satisfies readonly Plan[];
export type MarketedPlan = (typeof MARKETED_PLANS)[number];

export type PlanMarketing = {
  /** Display name, e.g. "Starter". */
  label: string;
  /** "₹0" or "₹299/mo". */
  price: string;
  /** Just the amount: "₹0" / "₹299". */
  amount: string;
  /** Billing period suffix, or null for a free tier. */
  period: "/mo" | null;
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

function pricing(plan: Plan): Pick<PlanMarketing, "price" | "amount" | "period"> {
  const paise = PLAN_PRICES_PAISE[plan];
  const amount = formatINRCompact(paise);
  const period = paise === 0 ? null : "/mo";
  return { amount, period, price: `${amount}${period ?? ""}` };
}

const FREE_CAP = PLAN_LIMITS.FREE.monthlyTxnCap;
const STARTER_CAP = PLAN_LIMITS.STARTER.monthlyTxnCap;
const STARTER_CSV = PLAN_LIMITS.STARTER.csvExport;

export const PLAN_MARKETING: Record<MarketedPlan, PlanMarketing> = {
  FREE: {
    label: PLAN_LIMITS.FREE.label,
    ...pricing("FREE"),
    teaser: `${FREE_CAP} bills a month free. Voice + UPI QR + WhatsApp receipts.`,
    summary: "Try AwaazOS on your stall.",
    bullets: [
      billsPerMonth("FREE"),
      "Voice billing in English & Hindi",
      "UPI QR on every bill",
      "WhatsApp receipts from your own WhatsApp",
      analyticsDays("FREE"),
    ],
    emphasis: false,
  },
  STARTER: {
    label: PLAN_LIMITS.STARTER.label,
    ...pricing("STARTER"),
    teaser: `Up to ${STARTER_CAP} bills a month and ${PLAN_LIMITS.STARTER.analyticsDays} days of analytics${
      STARTER_CSV ? ", with CSV export" : ""
    }. Most vendors live here.`,
    summary: "For a counter that's getting busy.",
    bullets: [
      "Everything in Free",
      billsPerMonth("STARTER"),
      analyticsDays("STARTER"),
      ...(STARTER_CSV ? ["CSV export of your bills"] : []),
    ],
    emphasis: true,
  },
};
