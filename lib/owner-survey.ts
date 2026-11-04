/**
 * Owner survey: what is hard about running the store, how big it is, and what
 * the owner would pay. Pure and client-safe; the database side is in
 * lib/owner-survey-server.ts.
 *
 * Two readers:
 * - `summariseSurvey` ranks the pains across stores on /admin/survey, to decide
 *   what to build next.
 * - A SUPER_ADMIN reads one store's answers beside its price on /admin/vendors.
 *   Answers never change a price by themselves (lib/subscription.ts has the
 *   price rules). The form tells the owner their answers may inform it.
 *
 * Keys are stored on the row, so never rename one. Retire a pain by moving it
 * out of OWNER_PAINS into RETIRED_PAIN_LABELS, so old answers still read.
 *
 * The same questions go out on the public /survey link, for sellers with no
 * account. Those answers (`PublicSurveyResponse`) are tied to no store, can't be
 * changed afterwards and never inform a price, so /admin/survey counts them
 * apart from the stores' own: nothing stops one person answering twice.
 *
 * The comment is the owner's free text and may name people: never in a log.
 */
import { z } from "zod";

export const OWNER_PAINS = [
  { key: "orders_scattered", label: "Orders get lost across DMs and WhatsApp" },
  { key: "payment_matching", label: "Checking who has paid" },
  { key: "overselling", label: "Taking more orders than I can make" },
  { key: "day_planning", label: "Working out what to make or pack, and for whom" },
  { key: "same_questions", label: "Answering the same price questions again and again" },
  { key: "delivery", label: "Booking delivery and briefing riders" },
  { key: "new_customers", label: "Finding new customers" },
  { key: "repeat_customers", label: "Getting past customers to order again" },
  { key: "posting", label: "Making posts and stories" },
  { key: "profit", label: "Knowing my sales and profit" },
  { key: "ingredients", label: "Tracking stock, ingredients and costs" },
  { key: "gst_invoices", label: "GST bills and invoices" },
] as const;

export type OwnerPainKey = (typeof OWNER_PAINS)[number]["key"];

const OWNER_PAIN_KEYS = OWNER_PAINS.map((p) => p.key) as [OwnerPainKey, ...OwnerPainKey[]];

const RETIRED_PAIN_LABELS: Readonly<Record<string, string>> = {};

export const WEEKLY_ORDER_BANDS = [
  { key: "under_10", label: "Under 10" },
  { key: "10_30", label: "10 to 30" },
  { key: "30_80", label: "30 to 80" },
  { key: "80_200", label: "80 to 200" },
  { key: "over_200", label: "Over 200" },
] as const;

export type WeeklyOrderBand = (typeof WEEKLY_ORDER_BANDS)[number]["key"];

/** A month, before GST. Bands, not a number: a stated figure is only a rough signal. */
export const WILLING_TO_PAY_BANDS = [
  { key: "nothing_yet", label: "Nothing yet" },
  { key: "under_199", label: "Under ₹199" },
  { key: "199_499", label: "₹199 to ₹499" },
  { key: "499_999", label: "₹499 to ₹999" },
  { key: "over_999", label: "₹1,000 or more" },
] as const;

export type WillingToPayBand = (typeof WILLING_TO_PAY_BANDS)[number]["key"];

export const SURVEY_COMMENT_MAX = 500;

/** Shown above the form. Says plainly what the answers are used for. */
export const SURVEY_USE_NOTICE =
  "We read every answer. It decides what we build next, and we may use it to offer your store a price that fits.";

/** Shown above the public form: there is no store to price, and no reason to leave a name. */
export const PUBLIC_SURVEY_NOTICE =
  "We read every answer, and it decides what we build next. No sign-in, and we don't ask for your name or number.";

export const ownerSurveySchema = z
  .object({
    pains: z
      .array(z.enum(OWNER_PAIN_KEYS))
      .min(1)
      .max(OWNER_PAINS.length)
      .refine((pains) => new Set(pains).size === pains.length, "Repeated answer"),
    topPain: z.enum(OWNER_PAIN_KEYS),
    weeklyOrders: z.enum(WEEKLY_ORDER_BANDS.map((b) => b.key) as [WeeklyOrderBand, ...WeeklyOrderBand[]]),
    willingToPay: z.enum(WILLING_TO_PAY_BANDS.map((b) => b.key) as [WillingToPayBand, ...WillingToPayBand[]]),
    comment: z
      .string()
      .trim()
      .max(SURVEY_COMMENT_MAX)
      .transform((c) => c || null)
      .nullish()
      .transform((c) => c ?? null),
  })
  .refine((a) => a.pains.includes(a.topPain), { path: ["topPain"], message: "Pick one of the problems you chose" });

export type OwnerSurveyInput = z.input<typeof ownerSurveySchema>;

export type OwnerSurveyAnswers = {
  pains: readonly string[];
  topPain: string;
  weeklyOrders: string;
  willingToPay: string;
  comment: string | null;
};

function labelFrom(list: readonly { key: string; label: string }[], key: string): string {
  return list.find((item) => item.key === key)?.label ?? key;
}

export function painLabel(key: string): string {
  return RETIRED_PAIN_LABELS[key] ?? labelFrom(OWNER_PAINS, key);
}

export function weeklyOrdersLabel(key: string): string {
  return labelFrom(WEEKLY_ORDER_BANDS, key);
}

export function willingToPayLabel(key: string): string {
  return labelFrom(WILLING_TO_PAY_BANDS, key);
}

export type PainTally = {
  key: string;
  label: string;
  /** Stores that named it. */
  named: number;
  /** Stores for which it hurts most. */
  top: number;
};

export type BandTally = { key: string; label: string; count: number };

export type SurveySummary = {
  responses: number;
  pains: PainTally[];
  weeklyOrders: BandTally[];
  willingToPay: BandTally[];
};

function tallyBands(
  bands: readonly { key: string; label: string }[],
  answers: readonly string[],
): BandTally[] {
  return bands.map((b) => ({ key: b.key, label: b.label, count: answers.filter((a) => a === b.key).length }));
}

/**
 * Most-felt first: "hurts most" outranks "also named", then how many named it.
 * Pains nobody named are left out. Retired keys still count.
 */
export function summariseSurvey(rows: readonly OwnerSurveyAnswers[]): SurveySummary {
  const byKey = new Map<string, PainTally>();
  const entry = (key: string) => {
    let tally = byKey.get(key);
    if (!tally) {
      tally = { key, label: painLabel(key), named: 0, top: 0 };
      byKey.set(key, tally);
    }
    return tally;
  };
  for (const row of rows) {
    for (const key of row.pains) entry(key).named += 1;
    entry(row.topPain).top += 1;
  }
  return {
    responses: rows.length,
    pains: [...byKey.values()].sort(
      (a, b) => b.top - a.top || b.named - a.named || a.label.localeCompare(b.label),
    ),
    weeklyOrders: tallyBands(
      WEEKLY_ORDER_BANDS,
      rows.map((r) => r.weeklyOrders),
    ),
    willingToPay: tallyBands(
      WILLING_TO_PAY_BANDS,
      rows.map((r) => r.willingToPay),
    ),
  };
}
