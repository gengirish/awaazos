/**
 * Seller heartbeat for /admin/metrics: one row per real store with its last 14
 * days of paid bills, how long it has been idle, and a churn-risk badge.
 * Definitions are in docs/admin-redesign/PHASE-2.md. Pure and client-safe; the
 * rows come from `loadSellerHeartbeat` (lib/seller-heartbeat-server.ts).
 *
 * Every day here is an IST calendar day. The sparkline and the 7-day figures
 * cover complete days only (the 14 before today), like the rest of the page;
 * days idle counts from the last paid bill at any time, today included.
 */
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";
import { firstName as firstNameOf } from "@/lib/outreach-message";

const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const SPARK_DAYS = 14;
const WEEK = 7;

export const HEARTBEAT_BADGES = ["at_risk", "watch", "new", "healthy"] as const;
export type HeartbeatBadge = (typeof HEARTBEAT_BADGES)[number];

export const BADGE_LABEL: Record<HeartbeatBadge, string> = {
  at_risk: "At risk",
  watch: "Watch",
  new: "New",
  healthy: "Healthy",
};

export type HeartbeatSellerInput = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  /** Latest paid bill at any time, or null when the store has never been paid. */
  lastPaidAt: Date | null;
  ownerName: string | null;
  /** Number to nudge on, or null (no number saved, or the viewer may not see contacts). */
  phone: string | null;
};

export type HeartbeatBill = { vendorId: string; paidAt: Date; totalPaise: number; source: string };

export type HeartbeatRow = {
  id: string;
  name: string;
  slug: string;
  badge: HeartbeatBadge;
  /** Paid bills per IST day, oldest first, the 14 days before today. */
  spark: number[];
  /** IST days since the last paid bill (0 = today); null when never paid. */
  daysIdle: number | null;
  ageDays: number;
  gmv7dPaise: number;
  bills7d: number;
  billsPrior7d: number;
  /** VOICE ÷ paid bills over the 7 days; null with no paid bills. */
  voiceShare7d: number | null;
  ownerName: string | null;
  phone: string | null;
};

/** Days since the IST epoch: equal for two instants on the same IST calendar day. */
export function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / MS_PER_DAY);
}

export function heartbeatBadge(input: {
  ageDays: number;
  daysIdle: number | null;
  bills7d: number;
  billsPrior7d: number;
}): HeartbeatBadge {
  const cfg = ADMIN_METRICS_CONFIG.heartbeat;
  if (input.ageDays < cfg.newSellerDays) return "new";
  if (input.daysIdle === null || input.daysIdle >= cfg.atRiskIdleDays) return "at_risk";
  const collapsed =
    input.billsPrior7d >= cfg.dropMinPriorBills && input.bills7d <= input.billsPrior7d * cfg.dropShare;
  if (collapsed) return "at_risk";
  if (input.daysIdle >= cfg.watchIdleDays) return "watch";
  return "healthy";
}

const BADGE_RANK: Record<HeartbeatBadge, number> = { at_risk: 0, watch: 1, new: 2, healthy: 3 };

/** Riskiest first: badge, then longest idle (never paid first), then smaller 7-day sales, then name. */
export function compareByRisk(a: HeartbeatRow, b: HeartbeatRow): number {
  return (
    BADGE_RANK[a.badge] - BADGE_RANK[b.badge] ||
    (b.daysIdle ?? Infinity) - (a.daysIdle ?? Infinity) ||
    a.gmv7dPaise - b.gmv7dPaise ||
    a.name.localeCompare(b.name, "en-IN")
  );
}

export function buildHeartbeat(
  sellers: readonly HeartbeatSellerInput[],
  bills: readonly HeartbeatBill[],
  now: Date = new Date(),
): HeartbeatRow[] {
  const today = istDayNumber(now);
  const firstDay = today - SPARK_DAYS;
  const byVendor = new Map<string, { spark: number[]; gmv7d: number; voice7d: number }>();
  for (const s of sellers) byVendor.set(s.id, { spark: Array(SPARK_DAYS).fill(0), gmv7d: 0, voice7d: 0 });

  for (const bill of bills) {
    const acc = byVendor.get(bill.vendorId);
    const i = istDayNumber(bill.paidAt) - firstDay;
    if (!acc || i < 0 || i >= SPARK_DAYS) continue;
    acc.spark[i] += 1;
    if (i >= SPARK_DAYS - WEEK) {
      acc.gmv7d += bill.totalPaise;
      if (bill.source === "VOICE") acc.voice7d += 1;
    }
  }

  const rows = sellers.map((s): HeartbeatRow => {
    const acc = byVendor.get(s.id)!;
    const bills7d = acc.spark.slice(SPARK_DAYS - WEEK).reduce((a, b) => a + b, 0);
    const billsPrior7d = acc.spark.slice(0, SPARK_DAYS - WEEK).reduce((a, b) => a + b, 0);
    const daysIdle = s.lastPaidAt ? today - istDayNumber(s.lastPaidAt) : null;
    const ageDays = today - istDayNumber(s.createdAt);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      badge: heartbeatBadge({ ageDays, daysIdle, bills7d, billsPrior7d }),
      spark: acc.spark,
      daysIdle,
      ageDays,
      gmv7dPaise: acc.gmv7d,
      bills7d,
      billsPrior7d,
      voiceShare7d: bills7d === 0 ? null : acc.voice7d / bills7d,
      ownerName: s.ownerName,
      phone: s.phone,
    };
  });
  return rows.sort(compareByRisk);
}

export function parseBadgeFilter(raw: string | string[] | undefined): HeartbeatBadge | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HEARTBEAT_BADGES.find((b) => b === value) ?? null;
}

export function countByBadge(rows: readonly HeartbeatRow[]): Record<HeartbeatBadge, number> {
  const counts = { at_risk: 0, watch: 0, new: 0, healthy: 0 };
  for (const r of rows) counts[r.badge] += 1;
  return counts;
}

// ─── Nudge copy ─────────────────────────────────────────────────────

export type NudgeTemplateKey = "at-risk" | "never-paid" | "watch" | "new" | "healthy";

/** Which file in content/admin-nudges/ a row's Nudge starts from. */
export function nudgeTemplateKey(row: Pick<HeartbeatRow, "badge" | "daysIdle">): NudgeTemplateKey {
  if (row.badge === "at_risk") return row.daysIdle === null ? "never-paid" : "at-risk";
  return row.badge;
}

export type NudgeVars = {
  firstName: string | null;
  senderName: string | null;
  storeName: string;
  storeUrl: string;
  daysIdle: number | null;
};

/**
 * Fills {firstName} {senderName} {storeName} {storeUrl} {daysIdle} in a template from
 * content/admin-nudges/. An empty first name takes its space with it
 * ("Hi {firstName}," → "Hi,"), as in lib/demo-pipeline.ts. Unknown tokens stay
 * as typed, so a typo in the file shows up in the message instead of vanishing.
 */
export function fillNudgeTemplate(template: string, vars: NudgeVars): string {
  const first = firstNameOf(vars.firstName);
  return template
    .trim()
    .replace(/ ?\{firstName\}/g, (m) => (first ? m.replace("{firstName}", first) : ""))
    .replace(/\{senderName\}/g, firstNameOf(vars.senderName) || "the team")
    .replace(/\{storeName\}/g, vars.storeName)
    .replace(/\{storeUrl\}/g, vars.storeUrl)
    .replace(/\{daysIdle\}/g, vars.daysIdle === null ? "" : String(vars.daysIdle));
}
