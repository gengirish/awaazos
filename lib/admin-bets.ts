/**
 * The Bet Board on /admin/bets: a product bet is a hypothesis tied to one
 * metric, a target, a deadline and, at the end, a keep / kill decision. Pure and
 * client-safe; the database side is lib/admin-bets-server.ts. Definitions:
 * docs/admin-redesign/PHASE-4.md.
 *
 * - Every metric is the same number /admin/metrics shows: the last 7 complete
 *   IST days, so a bet reads the current week, not a running total.
 * - Targets are stored as integers in the metric's unit: basis points for a
 *   share (3000 = 30%), a plain count, or paise.
 * - Status: green when the target is met now; amber while it isn't and the
 *   deadline (an IST day, inclusive) is still ahead; red once it has passed
 *   unmet. Shown as a dot plus words, never colour alone, and never an emoji
 *   (the design system keeps emoji out of UI affordances).
 */
import { z } from "zod";

import type { AdminMetrics } from "@/lib/admin-metrics";
import { paiseToRupeesInput, parseRupeesInput } from "@/lib/cash-tender";
import { formatINR } from "@/lib/currency";
import type { OrderFunnel } from "@/lib/order-funnel";

export type MetricUnit = "percent" | "count" | "paise";

export const BET_METRICS = {
  voice_share: {
    label: "Voice share of paid bills",
    unit: "percent",
    help: "Paid bills rung up by voice ÷ all paid bills, storefront orders included.",
  },
  voice_share_counter: {
    label: "Voice share of counter bills",
    unit: "percent",
    help: "Paid bills rung up by voice ÷ paid counter bills (storefront orders left out).",
  },
  active_sellers: { label: "Active sellers", unit: "count", help: "Sellers with at least 1 paid bill." },
  paid_bills_7d: { label: "Paid bills", unit: "count", help: "Every paid bill, counter and storefront." },
  gmv_7d: { label: "Sales (GMV)", unit: "paise", help: "Sum of paid bills' totals." },
  storefront_paid_share: {
    label: "Storefront orders paid",
    unit: "percent",
    help: "Storefront orders placed in the 7 days that are paid now ÷ all placed.",
  },
  instagram_orders_7d: {
    label: "Orders from Instagram",
    unit: "count",
    help: "Storefront orders from Instagram (tracked from 04/11/2026).",
  },
} as const satisfies Record<string, { label: string; unit: MetricUnit; help: string }>;

export type BetMetricKey = keyof typeof BET_METRICS;
export const BET_METRIC_KEYS = Object.keys(BET_METRICS) as [BetMetricKey, ...BetMetricKey[]];

export function isBetMetricKey(key: string): key is BetMetricKey {
  return Object.hasOwn(BET_METRICS, key);
}

// ─── Metric values ──────────────────────────────────────────────────

/** A share keeps its parts, so "12.5% (5 of 40)" can be shown and compared without rounding. */
export type MetricValue =
  | { unit: "percent"; num: number; den: number }
  | { unit: "count"; value: number }
  | { unit: "paise"; value: number };

export type MetricSnapshot = Record<BetMetricKey, MetricValue>;

/** Every bet metric from what /admin/bets already loads for the same 7 days. */
export function metricSnapshot(
  metrics: Pick<AdminMetrics, "activeSellers" | "voiceShare" | "gmvPaise" | "instagram">,
  funnel: Pick<OrderFunnel, "placed" | "paid">,
): MetricSnapshot {
  const v = metrics.voiceShare;
  return {
    voice_share: { unit: "percent", num: v.voiceBills, den: v.paidBills },
    voice_share_counter: { unit: "percent", num: v.voiceBills, den: v.counterPaidBills },
    active_sellers: { unit: "count", value: metrics.activeSellers.current },
    paid_bills_7d: { unit: "count", value: v.paidBills },
    gmv_7d: { unit: "paise", value: metrics.gmvPaise.current },
    storefront_paid_share: { unit: "percent", num: funnel.paid.total, den: funnel.placed.total },
    instagram_orders_7d: { unit: "count", value: metrics.instagram.orders },
  };
}

/** Basis points → "30.0%" or "12.5%", with integer arithmetic only. */
export function formatBps(bps: number): string {
  const tenths = Math.floor(bps / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export function formatTarget(unit: MetricUnit, target: number): string {
  if (unit === "percent") return formatBps(target);
  if (unit === "paise") return formatINR(target);
  return target.toLocaleString("en-IN");
}

/** "12.5% (5 of 40)", "–" for a share with nothing to divide by, "₹1,250.00", "7". */
export function formatMetricValue(value: MetricValue): string {
  if (value.unit === "percent") {
    if (value.den === 0) return "–";
    return `${formatBps(Math.floor((value.num * 10_000) / value.den))} (${value.num.toLocaleString("en-IN")} of ${value.den.toLocaleString("en-IN")})`;
  }
  if (value.unit === "paise") return formatINR(value.value);
  return value.value.toLocaleString("en-IN");
}

export type Comparator = "GTE" | "LTE";

/** Whether the value meets the target; null when a share has no denominator yet. */
export function meetsTarget(value: MetricValue, target: number, comparator: Comparator): boolean | null {
  if (value.unit === "percent") {
    if (value.den === 0) return null;
    // num/den vs target/10 000, cross-multiplied: no rounding at the boundary.
    const left = value.num * 10_000;
    const right = target * value.den;
    return comparator === "GTE" ? left >= right : left <= right;
  }
  return comparator === "GTE" ? value.value >= target : value.value <= target;
}

// ─── Status ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export type BetTone = "green" | "amber" | "red";

export type BetStatus = {
  tone: BetTone;
  label: string;
  met: boolean | null;
  /** IST days from today to the deadline: 0 on the day, negative once passed. */
  daysLeft: number;
};

/** "YYYY-MM-DD" of the IST calendar day `now` falls on. */
export function istYmd(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** A `@db.Date` value (midnight UTC of the calendar day) → "YYYY-MM-DD". */
export function dateOnlyYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ymdToDateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** "2026-12-15" yes; "2026-02-30", "15/12/2026" or "" no. Never throws. */
export function isRealYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = ymdToDateOnly(s);
  return !Number.isNaN(d.getTime()) && dateOnlyYmd(d) === s;
}

export function betStatus(input: {
  value: MetricValue;
  targetValue: number;
  comparator: Comparator;
  deadline: Date;
  now: Date;
}): BetStatus {
  const met = meetsTarget(input.value, input.targetValue, input.comparator);
  const daysLeft = Math.round((input.deadline.getTime() - ymdToDateOnly(istYmd(input.now)).getTime()) / DAY_MS);
  if (met) return { tone: "green", label: "Target met", met, daysLeft };
  if (daysLeft < 0) return { tone: "red", label: "Deadline passed, target not met", met, daysLeft };
  return { tone: "amber", label: met === null ? "No data yet" : "Not met yet", met, daysLeft };
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return "1 day left";
  if (daysLeft === 0) return "Deadline is today";
  return daysLeft === -1 ? "Deadline passed yesterday" : `Deadline passed ${-daysLeft} days ago`;
}

// ─── Target input ───────────────────────────────────────────────────

/** What the admin types ("30", "12.5", "1,500", "2500.50") → the stored integer, or null. */
export function parseTargetInput(unit: MetricUnit, raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  if (unit === "paise") return parseRupeesInput(s);
  if (unit === "count") return /^\d{1,7}$/.test(s) ? Number(s) : null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** The stored integer → what the edit form shows. */
export function targetToInput(unit: MetricUnit, target: number): string {
  if (unit === "paise") return paiseToRupeesInput(target);
  if (unit === "count") return String(target);
  const frac = target % 100;
  const whole = (target - frac) / 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

// ─── API shapes ─────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdSchema = z
  .string()
  .refine(isRealYmd, "Pick a real date")
  .refine((s) => s >= "2026-01-01" && s <= "2030-12-31", "Pick a date between 2026 and 2030");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s ? s : null));

export const BET_TITLE_MAX = 80;
export const BET_HYPOTHESIS_MAX = 500;
export const BET_NOTES_MAX = 1000;

/** POST /api/admin/bets and PATCH /api/admin/bets/[id] (the whole bet, every time). */
export const betInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the bet a title").max(BET_TITLE_MAX),
    hypothesis: z.string().trim().min(1, "Write the hypothesis").max(BET_HYPOTHESIS_MAX),
    metricKey: z.enum(BET_METRIC_KEYS),
    targetValue: z.number().int().min(0).max(2_000_000_000),
    comparator: z.enum(["GTE", "LTE"]),
    deadline: ymdSchema,
    decision: z.enum(["PENDING", "KEEP", "KILL"]).default("PENDING"),
    notes: optionalText(BET_NOTES_MAX),
  })
  .refine((b) => BET_METRICS[b.metricKey].unit !== "percent" || b.targetValue <= 10_000, {
    path: ["targetValue"],
    message: "A share can't be over 100%",
  });

export type BetInput = z.infer<typeof betInputSchema>;

/** What the bet routes answer with, checked before it is sent. */
export const betOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  hypothesis: z.string(),
  metricKey: z.string(),
  targetValue: z.number().int(),
  comparator: z.enum(["GTE", "LTE"]),
  deadline: z.string().regex(YMD),
  decision: z.enum(["PENDING", "KEEP", "KILL"]),
  notes: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type BetOutput = z.infer<typeof betOutputSchema>;

export function toBetOutput(row: {
  id: string;
  title: string;
  hypothesis: string;
  metricKey: string;
  targetValue: number;
  comparator: Comparator;
  deadline: Date;
  decision: "PENDING" | "KEEP" | "KILL";
  notes: string | null;
  updatedAt: Date;
}): BetOutput {
  return betOutputSchema.parse({ ...row, deadline: dateOnlyYmd(row.deadline), updatedAt: row.updatedAt.toISOString() });
}

export const DECISION_LABEL: Record<BetOutput["decision"], string> = {
  PENDING: "Decision pending",
  KEEP: "Decided: keep",
  KILL: "Decided: kill",
};

export const BET_ERROR_TEXT: Record<string, string> = {
  not_found: "That bet no longer exists. Reload the page.",
};
