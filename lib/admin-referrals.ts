/**
 * Store-to-store referrals for the platform admin page `/admin/referrals` and
 * the two referral figures on `/admin/metrics` (rules in lib/referral.ts).
 *
 * Deliberately cross-tenant: these queries carry no `vendorId` scope, so every
 * caller must have passed `requirePlatformRole` first (SUPER_ADMIN for
 * /admin/referrals, ADMIN for /admin/metrics, which shows counts only). The
 * selects are allowlists: store name, slug and billing fields, never an
 * owner's name, phone or email.
 *
 * Demo stores are left out everywhere: they neither earn nor give rewards, so
 * a demo row could only be noise. Every query is bounded by a `take`.
 *
 * The aggregation (`buildTopReferrers`, `referralRewardStatus`) is pure so it
 * is unit-tested without a database.
 */
import type { Prisma, ReferralRewardStatus } from "@prisma/client";

import { istDayStart } from "@/lib/admin-metrics";
import { prisma } from "@/lib/prisma";

/** Most referrers the top table shows. */
export const TOP_REFERRERS_LIMIT = 100;
/** Window and cap of the recent referred sign-ups table. */
export const RECENT_REFERRALS_DAYS = 90;
export const RECENT_REFERRALS_LIMIT = 200;
/** Window of the two referral figures on /admin/metrics. */
export const REFERRAL_METRICS_DAYS = 30;

/** Upper bound on grouped rows read before aggregation (one row per referrer, or per referrer × status). */
const GROUP_READ_LIMIT = 1000;

export type ReferrerSignupGroup = { referrerVendorId: string; signedUp: number };
export type ReferrerRewardGroup = {
  referrerVendorId: string;
  status: ReferralRewardStatus;
  /** Reward rows (one per paying referred store). */
  rewards: number;
  months: number;
  /** Of `months`, how many refunds of the referrer's own charges used (EARNED rows only). */
  monthsUsed?: number;
};
export type ReferrerStore = { id: string; name: string; slug: string };

export type TopReferrerRow = ReferrerStore & {
  /** Stores that signed up through this store's link. */
  signedUp: number;
  /** Of those, stores whose first payment earned a reward. */
  rewarded: number;
  monthsEarned: number;
  monthsRedeemed: number;
  monthsBanked: number;
};

/**
 * One row per referrer, from grouped counts. Referrers missing from `stores`
 * (deleted, or demo stores filtered out by the caller) are dropped. Sorted by
 * months earned, then sign-ups, then name, and cut to `limit`.
 */
export function buildTopReferrers(
  signups: ReferrerSignupGroup[],
  rewards: ReferrerRewardGroup[],
  stores: ReferrerStore[],
  limit: number = TOP_REFERRERS_LIMIT,
): TopReferrerRow[] {
  const byId = new Map<string, TopReferrerRow>();
  for (const store of stores) {
    byId.set(store.id, {
      ...store,
      signedUp: 0,
      rewarded: 0,
      monthsEarned: 0,
      monthsRedeemed: 0,
      monthsBanked: 0,
    });
  }
  for (const g of signups) {
    const row = byId.get(g.referrerVendorId);
    if (row) row.signedUp += g.signedUp;
  }
  for (const g of rewards) {
    const row = byId.get(g.referrerVendorId);
    if (!row) continue;
    row.rewarded += g.rewards;
    row.monthsEarned += g.months;
    const used = g.monthsUsed ?? 0;
    if (g.status === "REDEEMED") row.monthsRedeemed += g.months;
    else {
      row.monthsRedeemed += used;
      row.monthsBanked += g.months - used;
    }
  }
  return [...byId.values()]
    .filter((r) => r.signedUp > 0 || r.rewarded > 0)
    .sort(
      (a, b) =>
        b.monthsEarned - a.monthsEarned || b.signedUp - a.signedUp || a.name.localeCompare(b.name, "en-IN"),
    )
    .slice(0, Math.max(0, limit));
}

/** Reward column of the recent sign-ups table. */
export function referralRewardStatus(
  reward: { months: number; status: ReferralRewardStatus } | null | undefined,
): string {
  if (!reward) return "None";
  const months = `${reward.months} ${reward.months === 1 ? "month" : "months"}`;
  return reward.status === "REDEEMED" ? `Redeemed (${months})` : `Earned ${months}, banked`;
}

/** Referrers that count: not demo stores. */
const REAL_REFERRER = { isDemo: false } satisfies Prisma.VendorWhereInput;

/** Top referrers across the platform (demo stores excluded). */
export async function loadTopReferrers(): Promise<TopReferrerRow[]> {
  const [signupGroups, rewardGroups] = await Promise.all([
    prisma.vendor.groupBy({
      by: ["referredByVendorId"],
      where: { referredByVendorId: { not: null }, isDemo: false, referredBy: REAL_REFERRER },
      _count: { _all: true },
      orderBy: { referredByVendorId: "asc" },
      take: GROUP_READ_LIMIT,
    }),
    prisma.referralReward.groupBy({
      by: ["referrerVendorId", "status"],
      where: { referrer: REAL_REFERRER },
      _count: { _all: true },
      _sum: { months: true, monthsUsed: true },
      orderBy: { referrerVendorId: "asc" },
      take: GROUP_READ_LIMIT,
    }),
  ]);

  const signups: ReferrerSignupGroup[] = signupGroups.flatMap((g) =>
    g.referredByVendorId ? [{ referrerVendorId: g.referredByVendorId, signedUp: g._count._all }] : [],
  );
  const rewards: ReferrerRewardGroup[] = rewardGroups.map((g) => ({
    referrerVendorId: g.referrerVendorId,
    status: g.status,
    rewards: g._count._all,
    months: g._sum.months ?? 0,
    monthsUsed: g._sum.monthsUsed ?? 0,
  }));

  const ids = [...new Set([...signups.map((s) => s.referrerVendorId), ...rewards.map((r) => r.referrerVendorId)])];
  const stores =
    ids.length === 0
      ? []
      : await prisma.vendor.findMany({
          where: { id: { in: ids }, ...REAL_REFERRER },
          select: { id: true, name: true, slug: true },
          take: GROUP_READ_LIMIT * 2,
        });

  return buildTopReferrers(signups, rewards, stores);
}

const RECENT_REFERRAL_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  plan: true,
  planExpiresAt: true,
  trialEndsAt: true,
  referredBy: { select: { name: true, slug: true } },
  referralRewardFrom: { select: { months: true, status: true } },
} satisfies Prisma.VendorSelect;

export type RecentReferralRow = Prisma.VendorGetPayload<{ select: typeof RECENT_REFERRAL_SELECT }>;

/** Stores that signed up through a referral in the last 90 days, newest first. */
export function loadRecentReferrals(now: Date = new Date()): Promise<RecentReferralRow[]> {
  return prisma.vendor.findMany({
    where: {
      referredByVendorId: { not: null },
      isDemo: false,
      referredBy: REAL_REFERRER,
      createdAt: { gte: istDayStart(RECENT_REFERRALS_DAYS, now) },
    },
    select: RECENT_REFERRAL_SELECT,
    orderBy: { createdAt: "desc" },
    take: RECENT_REFERRALS_LIMIT,
  });
}

export type ReferralMetrics = {
  /** Non-demo stores that signed up through a referral link in the window. */
  referredSignups: number;
  /** Rewards earned in the window, and the months they carry. */
  rewardsEarned: number;
  rewardMonthsEarned: number;
  since: Date;
};

/** The two referral figures on /admin/metrics (last 30 days, IST midnight). */
export async function getReferralMetrics(now: Date = new Date()): Promise<ReferralMetrics> {
  const since = istDayStart(REFERRAL_METRICS_DAYS, now);
  const [referredSignups, rewards] = await Promise.all([
    prisma.vendor.count({
      where: { referredByVendorId: { not: null }, isDemo: false, referredBy: REAL_REFERRER, createdAt: { gte: since } },
    }),
    prisma.referralReward.aggregate({
      where: { earnedAt: { gte: since }, referrer: REAL_REFERRER, referred: { isDemo: false } },
      _count: { _all: true },
      _sum: { months: true },
    }),
  ]);
  return {
    referredSignups,
    rewardsEarned: rewards._count._all,
    rewardMonthsEarned: rewards._sum.months ?? 0,
    since,
  };
}

/** How many refund rows /admin/referrals lists: every pending one, and the newest refunded. */
export const RECENT_CREDITS_LIMIT = 50;

export type ReferralCreditRow = {
  id: string;
  storeName: string;
  storeSlug: string;
  chargePaise: number;
  refundPaise: number;
  months: number;
  status: "PENDING" | "REFUNDED";
  lastError: string | null;
  createdAt: Date;
  refundedAt: Date | null;
};

/** Free-month refunds to paying referrers, pending first, then newest. */
export async function loadReferralCredits(): Promise<ReferralCreditRow[]> {
  const rows = await prisma.referralCredit.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: RECENT_CREDITS_LIMIT,
    select: {
      id: true,
      chargePaise: true,
      refundPaise: true,
      months: true,
      status: true,
      lastError: true,
      createdAt: true,
      refundedAt: true,
      vendor: { select: { name: true, slug: true } },
    },
  });
  return rows.map(({ vendor, ...r }) => ({ ...r, storeName: vendor.name, storeSlug: vendor.slug }));
}
