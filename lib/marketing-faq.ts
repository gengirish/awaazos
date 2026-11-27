/**
 * Questions a seller asks before signing up, for the landing page and /pricing
 * (components/marketing/Faq.tsx). Pure, client-safe.
 *
 * Rules:
 * - Only what ships. Every number comes from `lib/plan-copy.ts` / `lib/constants.ts`,
 *   so an answer can't drift from the prices or the trial the gates enforce.
 * - The trial is on Starter and ends with nothing charged (no card on file): the
 *   store stops taking new orders until the seller picks a plan (`billingAccess`
 *   → `locked`), and their records stay.
 * - The money is the seller's: UPI to their own ID, their own Razorpay account, or
 *   cash. Never say we collect it or pay it out.
 * - No promises about emails or support hours: those aren't guaranteed by code.
 */
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/constants";
import { MARKETED_PLANS, PLAN_MARKETING, PLANS_FROM, YEARLY_MONTHS_FREE } from "@/lib/plan-copy";

export type FaqItem = { question: string; answer: string };

const starter = PLAN_LIMITS.STARTER.label;

function listPlans(each: (plan: (typeof MARKETED_PLANS)[number]) => string): string {
  const parts = MARKETED_PLANS.map(each);
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

export const MARKETING_FAQ: readonly FaqItem[] = [
  {
    question: "Which plan is the free trial on?",
    answer: `${starter}, with everything in it, for ${TRIAL_DAYS} days. You don't need a card to start.`,
  },
  {
    question: "What happens when the trial ends?",
    answer: `Nothing is charged, because there is no card on file. Your store stops taking new orders until you pick a plan: ${listPlans((plan) => `${PLAN_MARKETING[plan].label} at ${PLAN_MARKETING[plan].amount}`)} a month + GST. Your items, orders and bills stay where they are.`,
  },
  {
    question: "Do you take a cut of my sales?",
    answer:
      "No. You pay the plan price and nothing per order. Buyers pay you directly: to your own UPI ID, into your own Razorpay account, or on delivery. Razorpay's own fees apply to online payments.",
  },
  {
    question: "Is there a yearly price?",
    answer: `Yes, on every plan, and it gets you ${YEARLY_MONTHS_FREE} months free: ${listPlans((plan) => `${PLAN_MARKETING[plan].label} ${PLAN_MARKETING[plan].yearlyPrice}`)}.`,
  },
  {
    question: "Do my buyers need an app or an account?",
    answer:
      "No. They open your store link from your Instagram bio or WhatsApp, choose, and pay in their phone's browser. Signing in is optional.",
  },
  {
    question: "Is it only for food?",
    answer:
      "No. Home kitchens and bakers use it, and so do home businesses selling wellness products, clothing, jewellery, candles and crafts. Your store says Menu or Products to match what you sell.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes, any time, from Settings → Billing. Your plan keeps running to the end of the period you paid for.",
  },
  {
    question: "Do prices include GST?",
    answer: `No. Plans start from ${PLANS_FROM} a month, and 18% GST is added when you pay.`,
  },
];
