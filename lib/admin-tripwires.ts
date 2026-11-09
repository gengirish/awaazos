/**
 * Instrumentation tripwires for /admin/metrics: a metric sitting at exactly 0
 * for ADMIN_METRICS_CONFIG.tripwireDays complete IST days while a metric that
 * feeds it is above 0 is more likely a tracking bug than a fact.
 *
 * Evaluated on each page render from per-day counts, never on a timer (Neon must
 * be able to sleep). A day counts only when tracking had started by its IST
 * midnight, so a field added mid-window can't fire before it has a week of data.
 * Pure and client-safe; the counts come from `getAdminMetrics`.
 */
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";

export type TripwireMetric = "instagramOrders" | "storefrontOrders" | "voiceBills" | "counterPaidBills";

export type DayCounts = {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  /** That day's 00:00 IST as a UTC instant. */
  start: Date;
  counts: Record<TripwireMetric, number>;
};

export type TripwireRule = {
  id: "instagram" | "voice";
  metric: TripwireMetric;
  related: TripwireMetric;
  /** First instant the metric could be non-zero. Undefined: always tracked. */
  trackedSince?: Date;
  title: string;
  /** Why it fired, shown in the banner. `{related}` is filled with the related total. */
  explanation: string;
};

export type TripwireStatus = "fired" | "clear" | "waiting";

export type TripwireResult = {
  id: TripwireRule["id"];
  status: TripwireStatus;
  title: string;
  explanation: string;
  /** Days in the window that were tracked. */
  trackedDays: number;
  requiredDays: number;
};

export const TRIPWIRE_RULES: readonly TripwireRule[] = [
  {
    id: "instagram",
    metric: "instagramOrders",
    related: "storefrontOrders",
    trackedSince: ADMIN_METRICS_CONFIG.tracking.orderChannelSince,
    title: "Orders from Instagram",
    explanation:
      "No order was tagged as from Instagram for 7 days, while {related} storefront orders came in. Check the Instagram in-app browser detection and ?src=ig links.",
  },
  {
    id: "voice",
    metric: "voiceBills",
    related: "counterPaidBills",
    title: "Voice share",
    explanation:
      "No paid bill was saved as rung up by voice for 7 days, while {related} counter bills were paid. Check that the till sends source = VOICE.",
  },
];

/** True when tracking had started by the day's IST midnight. */
function tracked(day: DayCounts, since: Date | undefined): boolean {
  return since === undefined || day.start.getTime() >= since.getTime();
}

export function evaluateTripwire(
  rule: TripwireRule,
  days: readonly DayCounts[],
  requiredDays: number = ADMIN_METRICS_CONFIG.tripwireDays,
): TripwireResult {
  const trackedDays = days.filter((d) => tracked(d, rule.trackedSince));
  const base = {
    id: rule.id,
    title: rule.title,
    trackedDays: trackedDays.length,
    requiredDays,
  };
  if (trackedDays.length < requiredDays) {
    return { ...base, status: "waiting", explanation: "" };
  }
  const recent = trackedDays.slice(-requiredDays);
  const metricTotal = recent.reduce((sum, d) => sum + d.counts[rule.metric], 0);
  const relatedTotal = recent.reduce((sum, d) => sum + d.counts[rule.related], 0);
  if (metricTotal === 0 && relatedTotal > 0) {
    return {
      ...base,
      status: "fired",
      explanation: rule.explanation.replace("{related}", relatedTotal.toLocaleString("en-IN")),
    };
  }
  return { ...base, status: "clear", explanation: "" };
}

export function evaluateTripwires(days: readonly DayCounts[], rules: readonly TripwireRule[] = TRIPWIRE_RULES): TripwireResult[] {
  return rules.map((rule) => evaluateTripwire(rule, days));
}
