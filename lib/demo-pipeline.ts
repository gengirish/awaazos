/**
 * The outreach pipeline's rules for /admin/demo-stores (docs/admin-pipeline.md).
 * Pure and client-safe: the page uses these to redraw after an action.
 *
 * No timers. A store's status, next action and queue position are derived from
 * its dates on every read; nothing is stored that could drift, and no job moves
 * a store along. Claiming flips `isDemo`, so the follow-ups stop by themselves.
 *
 * - Follow-ups wait for the admin: a due follow-up stays due until it is sent.
 *   Sent + 2 days → follow-up 1; that nudge + 3 days → follow-up 2; that nudge +
 *   5 days → expired. Nothing is ever sent from our side.
 * - Stale: never sent, no real order, 21 days old (or 21 days since a restore).
 *   It reads as archived, with no write.
 * - "Orders" are real ones: the caller counts `isSample: false`, uncancelled.
 *   A store stays "orders waiting" only until the seller has been contacted
 *   since the newest order, or Send could never clear it from the queue.
 */
import { firstName } from "@/lib/outreach-message";

const DAY_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_1_DAYS = 2;
export const FOLLOW_UP_2_DAYS = 3;
export const EXPIRE_DAYS = 5;
export const STALE_DAYS = 21;
export const SNOOZE_DAYS = 3;
/** A claimed store with no drop or order for this long gets a nudge, once it has been claimed this long. */
const QUIET_DROP_DAYS = 7;
const QUIET_ORDER_DAYS = 14;
const QUIET_NUDGE_DAYS = 7;

export const PIPELINE_ARCHIVE_REASONS = ["manual", "stale", "duplicate", "test"] as const;
export type PipelineArchiveReason = (typeof PIPELINE_ARCHIVE_REASONS)[number];

export type PipelineStatus =
  | "built"
  | "invite_sent"
  | "followup_1"
  | "followup_2"
  | "expired"
  | "claimed"
  | "archived";

export type PipelineFacts = {
  isDemo: boolean;
  createdAt: Date;
  /** Set when the store is claimed; null when the used handover row is gone. */
  claimedAt: Date | null;
  /** The recorded send, else the newest claim link: a link counts as sent. */
  inviteSentAt: Date | null;
  lastNudgeAt: Date | null;
  nudgeCount: number;
  snoozedUntil: Date | null;
  archivedAt: Date | null;
  archivedReason: PipelineArchiveReason | null;
  restoredAt: Date | null;
  /** Real, uncancelled orders. Sample orders never count. */
  orderCount: number;
  /** Newest real order of any status. */
  lastOrderAt: Date | null;
  dropsThisWeek: number;
};

export type PipelineState = {
  status: PipelineStatus;
  /** When the next follow-up falls due; null when none is coming. */
  nextActionAt: Date | null;
  /** The follow-up that is due now. */
  followUpDue: 1 | 2 | null;
  archivedReason: PipelineArchiveReason | null;
};

const plusDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);

export function pipelineState(f: PipelineFacts, now: Date = new Date()): PipelineState {
  const blank = { nextActionAt: null, followUpDue: null, archivedReason: null };
  if (!f.isDemo) return { ...blank, status: "claimed" };
  if (f.archivedAt) return { ...blank, status: "archived", archivedReason: f.archivedReason ?? "manual" };

  if (!f.inviteSentAt) {
    const staleSince = f.restoredAt ?? f.createdAt;
    if (f.orderCount === 0 && daysBetween(staleSince, now) >= STALE_DAYS) {
      return { ...blank, status: "archived", archivedReason: "stale" };
    }
    return { ...blank, status: "built" };
  }

  const last = f.lastNudgeAt ?? f.inviteSentAt;
  if (f.nudgeCount <= 0) {
    const due = plusDays(f.inviteSentAt, FOLLOW_UP_1_DAYS);
    return due > now
      ? { ...blank, status: "invite_sent", nextActionAt: due }
      : { ...blank, status: "followup_1", nextActionAt: due, followUpDue: 1 };
  }
  if (f.nudgeCount === 1) {
    const due = plusDays(last, FOLLOW_UP_2_DAYS);
    return due > now
      ? { ...blank, status: "followup_1", nextActionAt: due }
      : { ...blank, status: "followup_2", nextActionAt: due, followUpDue: 2 };
  }
  return plusDays(last, EXPIRE_DAYS) > now ? { ...blank, status: "followup_2" } : { ...blank, status: "expired" };
}

/** An unclaimed store with a real order nobody has told the seller about. */
export function isOrdersWaiting(f: PipelineFacts): boolean {
  if (!f.isDemo || f.archivedAt || f.orderCount === 0 || !f.lastOrderAt) return false;
  const contacted = f.lastNudgeAt ?? f.inviteSentAt;
  return !contacted || contacted < f.lastOrderAt;
}

/** A claimed store that has stopped using AwaazOS: no drop and no recent order, past its first week. */
export function isGoingQuiet(f: PipelineFacts, now: Date = new Date()): boolean {
  if (f.isDemo || f.dropsThisWeek > 0) return false;
  if (f.claimedAt && daysBetween(f.claimedAt, now) < QUIET_DROP_DAYS) return false;
  if (f.lastOrderAt && daysBetween(f.lastOrderAt, now) < QUIET_ORDER_DAYS) return false;
  return !(f.lastNudgeAt && daysBetween(f.lastNudgeAt, now) < QUIET_NUDGE_DAYS);
}

/**
 * Queue position, highest first; null = not in the queue (snoozed, archived,
 * waiting on the seller, nothing to do). +100 orders waiting, +60 follow-up due,
 * +40 fresh build losing a point a day, +30 going quiet.
 */
export function priorityScore(f: PipelineFacts, now: Date = new Date()): number | null {
  if (f.snoozedUntil && f.snoozedUntil > now) return null;
  const state = pipelineState(f, now);
  if (state.status === "archived") return null;
  let score = 0;
  if (isOrdersWaiting(f)) score += 100;
  if (state.followUpDue) score += 60;
  if (state.status === "built") score += Math.max(1, 40 - daysBetween(f.createdAt, now));
  if (isGoingQuiet(f, now)) score += 30;
  return score > 0 ? score : null;
}

/** The queue: highest score first, then newest. Sorts a copy. */
export function sortQueue<T extends { facts: PipelineFacts }>(items: readonly T[], now: Date = new Date()): T[] {
  return items
    .flatMap((item) => {
      const score = priorityScore(item.facts, now);
      return score === null ? [] : [{ item, score }];
    })
    .sort((a, b) => b.score - a.score || b.item.facts.createdAt.getTime() - a.item.facts.createdAt.getTime())
    .map((x) => x.item);
}

/** Why a store is in the queue, as a chip. */
export function queueReason(f: PipelineFacts, now: Date = new Date()): string {
  if (isOrdersWaiting(f)) return f.orderCount === 1 ? "Has 1 order" : `Has ${f.orderCount} orders`;
  const state = pipelineState(f, now);
  if (state.followUpDue) return `Follow-up ${state.followUpDue} due`;
  if (isGoingQuiet(f, now)) return "Going quiet";
  const days = daysBetween(f.createdAt, now);
  if (days <= 0) return "Built today";
  return days === 1 ? "Built 1 day ago" : `Built ${days} days ago`;
}

export type OutreachTemplateKind = "intro" | "followup_1" | "followup_2" | "orders_waiting" | "going_quiet";

/** Which message this store's next send starts from. */
export function templateKindFor(f: PipelineFacts, now: Date = new Date()): OutreachTemplateKind {
  if (!f.isDemo) return "going_quiet";
  if (isOrdersWaiting(f)) return "orders_waiting";
  const state = pipelineState(f, now);
  if (state.status === "followup_2") return "followup_2";
  return state.status === "built" || state.status === "archived" ? "intro" : "followup_1";
}

// ─── Tiles ──────────────────────────────────────────────────────────

export const PIPELINE_TILE_ORDER = ["built", "sent", "expired", "claimed"] as const;
export type PipelineTile = (typeof PIPELINE_TILE_ORDER)[number];

export const PIPELINE_TILE_LABEL: Record<PipelineTile, string> = {
  built: "Built, not sent",
  sent: "Invite sent",
  expired: "Invite expired",
  claimed: "Claimed",
};

export function pipelineTile(status: PipelineStatus): PipelineTile | null {
  switch (status) {
    case "built":
      return "built";
    case "invite_sent":
    case "followup_1":
    case "followup_2":
      return "sent";
    case "expired":
      return "expired";
    case "claimed":
      return "claimed";
    case "archived":
      return null;
  }
}

export const PIPELINE_STATUS_LABEL: Record<PipelineStatus, string> = {
  built: "Built, not sent",
  invite_sent: "Invite sent",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  expired: "Invite expired",
  claimed: "Claimed",
  archived: "Archived",
};

// ─── Hygiene ────────────────────────────────────────────────────────

export function normaliseStoreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A name too short to be a business, or one that starts like a keyboard test. */
export function looksLikeTestStore(name: string): boolean {
  const clean = normaliseStoreName(name);
  return clean.length < 4 || /^(test|asd|qwe|demo)/i.test(clean);
}

export type DuplicateCandidate = {
  id: string;
  name: string;
  area: string | null;
  phone: string | null;
  instagram: string | null;
};

/**
 * Other stores that look like the same seller, by store id: same name in the
 * same area (a missing area matches, since this only raises a chip), or the same
 * phone or Instagram handle.
 */
export function findDuplicates(stores: readonly DuplicateCandidate[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (a: string, b: string) => out.set(a, [...(out.get(a) ?? []), b]);
  const key = (s: string | null) => (s ?? "").trim().toLowerCase();
  for (let i = 0; i < stores.length; i++) {
    for (let j = i + 1; j < stores.length; j++) {
      const a = stores[i]!;
      const b = stores[j]!;
      const sameName = normaliseStoreName(a.name) === normaliseStoreName(b.name);
      const areaA = normaliseStoreName(a.area ?? "");
      const areaB = normaliseStoreName(b.area ?? "");
      const sameArea = !areaA || !areaB || areaA === areaB;
      const samePhone = key(a.phone) !== "" && key(a.phone) === key(b.phone);
      const sameHandle = key(a.instagram) !== "" && key(a.instagram) === key(b.instagram);
      if ((sameName && sameArea) || samePhone || sameHandle) {
        add(a.id, b.id);
        add(b.id, a.id);
      }
    }
  }
  return out;
}

// ─── Messages ───────────────────────────────────────────────────────

export type TemplateVars = {
  firstName: string | null;
  storeName: string;
  storeUrl: string;
  /** Left as the {claimUrl} token until the link is made at send time. */
  claimUrl?: string | null;
  area: string | null;
};

/**
 * Fills {firstName} {storeName} {storeUrl} {claimUrl} {area}. An empty first name
 * takes its space with it ("Hi {firstName}," → "Hi,"). A missing claim link keeps
 * its token, so the send can spot it.
 */
export function fillTemplate(template: string, vars: TemplateVars): string {
  const first = firstName(vars.firstName);
  return template
    .replace(/ ?\{firstName\}/g, (m) => (first ? m.replace("{firstName}", first) : ""))
    .replace(/\{storeName\}/g, vars.storeName)
    .replace(/\{storeUrl\}/g, vars.storeUrl)
    .replace(/\{area\}/g, vars.area ?? "")
    .replace(/\{claimUrl\}/g, vars.claimUrl ?? "{claimUrl}");
}

export function needsClaimLink(text: string): boolean {
  return text.includes("{claimUrl}");
}
