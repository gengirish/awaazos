/**
 * Database side of store-to-store referrals. Rules and their reasons are in
 * the header of lib/referral.ts; read it first. Server-only.
 */
import type { Prisma } from "@prisma/client";

import { billingAccess, type BillingAccess } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import {
  canPromoteReferrals,
  extendTrialEndsAt,
  isSelfReferral,
  monthsUnderCap,
  parseReferralCode,
  redemptionFor,
  REFERRAL_REWARD_CAP_PER_YEAR,
  rewardMonthsFor,
  type ReferralSummary,
} from "@/lib/referral";
import { LIVE_SUBSCRIPTION_STATUSES, type BillingInterval } from "@/lib/subscription";

type Tx = Prisma.TransactionClient;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The referrer for a sign-up, or null. Never throws for a bad code: an
 * unknown, inactive, demo or self-referring store is simply no referrer.
 */
export async function resolveReferrerForSignUp(
  rawCode: string | null | undefined,
  signUp: { email: string; phone: string | null | undefined },
  db: Tx | typeof prisma = prisma,
): Promise<{ id: string } | null> {
  const slug = parseReferralCode(rawCode);
  if (!slug) return null;
  const referrer = await db.vendor.findUnique({
    where: { slug },
    select: { id: true, isActive: true, isDemo: true, email: true, phone: true },
  });
  if (!referrer || !referrer.isActive || referrer.isDemo) return null;
  if (isSelfReferral(referrer, signUp)) return null;
  return { id: referrer.id };
}

/**
 * The orders board's prompt: a store that can use the reward now, has its store
 * published (something to show the seller it invites) and has no invite yet.
 * Read on page render only.
 */
export async function shouldAskToRefer(input: {
  vendor: { id: string; isDemo: boolean };
  role: string;
  access: BillingAccess;
  published: boolean;
  razorpaySubStatus: string | null | undefined;
}): Promise<boolean> {
  const hasLiveSubscription = LIVE_SUBSCRIPTION_STATUSES.includes(input.razorpaySubStatus ?? "");
  if (!input.published) return false;
  if (!canPromoteReferrals({ role: input.role, isDemo: input.vendor.isDemo, access: input.access, hasLiveSubscription })) {
    return false;
  }
  const invited = await prisma.vendor.count({ where: { referredByVendorId: input.vendor.id } });
  return invited === 0;
}

export type EarnReferralRewardResult =
  | { kind: "none" } // not referred, demo, already rewarded, or capped
  | { kind: "earned"; referrerVendorId: string; months: number; redeemed: boolean };

/**
 * Called inside `recordSubscriptionEvent`'s transaction for a
 * `subscription.charged` event with a positive amount. Earns the referrer's
 * reward the first time the referred store pays, and applies it at once when
 * `redemptionFor` says so. Idempotent: `ReferralReward.referredVendorId` is
 * unique and checked first, so a second charge (or a replayed event) does
 * nothing.
 */
export async function earnReferralRewardInTx(
  tx: Tx,
  input: {
    referredVendorId: string;
    sourceEventId: string;
    interval: BillingInterval;
    now?: Date;
  },
): Promise<EarnReferralRewardResult> {
  const now = input.now ?? new Date();
  const referred = await tx.vendor.findUnique({
    where: { id: input.referredVendorId },
    select: { referredByVendorId: true, isDemo: true, referralRewardFrom: { select: { id: true } } },
  });
  if (!referred?.referredByVendorId || referred.isDemo || referred.referralRewardFrom) {
    return { kind: "none" };
  }
  const referrerVendorId = referred.referredByVendorId;

  // Serialise rewards for one referrer so two charges can't both pass the cap.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM vendors WHERE id = ${referrerVendorId} FOR UPDATE`;
  if (locked.length === 0) return { kind: "none" };

  const referrer = await tx.vendor.findUniqueOrThrow({
    where: { id: referrerVendorId },
    select: {
      isDemo: true,
      isActive: true,
      plan: true,
      planExpiresAt: true,
      trialEndsAt: true,
      settings: { select: { razorpaySubStatus: true } },
    },
  });
  if (referrer.isDemo || !referrer.isActive) return { kind: "none" };

  const earnedLastYear = await tx.referralReward.aggregate({
    where: { referrerVendorId, earnedAt: { gte: new Date(now.getTime() - YEAR_MS) } },
    _sum: { months: true },
  });
  const months = monthsUnderCap(earnedLastYear._sum.months ?? 0, rewardMonthsFor(input.interval));
  if (months <= 0) return { kind: "none" };

  const hasLiveSub = LIVE_SUBSCRIPTION_STATUSES.includes(referrer.settings?.razorpaySubStatus ?? "");
  const redemption = redemptionFor(billingAccess(referrer, now), hasLiveSub);
  const redeemNow = redemption.kind === "extend_trial";

  await tx.referralReward.create({
    data: {
      referrerVendorId,
      referredVendorId: input.referredVendorId,
      months,
      sourceEventId: input.sourceEventId,
      earnedAt: now,
      ...(redeemNow
        ? { status: "REDEEMED", redeemedVia: "trial_extension", redeemedAt: now }
        : {}),
    },
  });
  if (redeemNow) {
    await tx.vendor.update({
      where: { id: referrerVendorId },
      data: { trialEndsAt: extendTrialEndsAt(referrer.trialEndsAt, months, now) },
    });
  }
  return { kind: "earned", referrerVendorId, months, redeemed: redeemNow };
}

/**
 * Applies every banked reward month just before a subscription is created,
 * by moving `trialEndsAt` forward; the caller then reads the new trial end as
 * the first charge date (`start_at`). Returns the new `trialEndsAt`, or null
 * when nothing was banked. Runs only when the vendor has no live
 * subscription (create-subscription refuses otherwise).
 *
 * A grandfathered FREE store (trialEndsAt null) gets a trial end here for the
 * first time, so if it later cancels it locks instead of going back to FREE.
 */
export async function redeemBankedRewardsAtSubscribe(
  vendorId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM vendors WHERE id = ${vendorId} FOR UPDATE`;
    const banked = await tx.referralReward.findMany({
      where: { referrerVendorId: vendorId, status: "EARNED" },
      select: { id: true, months: true },
    });
    if (banked.length === 0) return null;
    const months = banked.reduce((n, r) => n + r.months, 0);
    const vendor = await tx.vendor.findUniqueOrThrow({
      where: { id: vendorId },
      select: { trialEndsAt: true, planExpiresAt: true },
    });
    // Count from whichever covered time ends later, so free months never
    // overlap the trial or what is left of a paid period.
    const coveredUntil =
      vendor.planExpiresAt &&
      (!vendor.trialEndsAt || vendor.planExpiresAt.getTime() > vendor.trialEndsAt.getTime())
        ? vendor.planExpiresAt
        : vendor.trialEndsAt;
    const trialEndsAt = extendTrialEndsAt(coveredUntil, months, now);
    await tx.vendor.update({ where: { id: vendorId }, data: { trialEndsAt } });
    await tx.referralReward.updateMany({
      where: { id: { in: banked.map((r) => r.id) }, referrerVendorId: vendorId, status: "EARNED" },
      data: { status: "REDEEMED", redeemedVia: "subscribe_start", redeemedAt: now },
    });
    return trialEndsAt;
  });
}

/** Counts for Settings → Refer a seller. */
export async function loadReferralSummary(
  vendor: { id: string; slug: string },
  now: Date = new Date(),
): Promise<ReferralSummary> {
  const [signedUp, rewards] = await Promise.all([
    prisma.vendor.count({ where: { referredByVendorId: vendor.id } }),
    prisma.referralReward.findMany({
      where: { referrerVendorId: vendor.id },
      select: { months: true, status: true, earnedAt: true },
    }),
  ]);
  let monthsRedeemed = 0;
  let monthsBanked = 0;
  let monthsLastYear = 0;
  const yearAgo = now.getTime() - YEAR_MS;
  for (const r of rewards) {
    if (r.status === "REDEEMED") monthsRedeemed += r.months;
    else monthsBanked += r.months;
    if (r.earnedAt.getTime() >= yearAgo) monthsLastYear += r.months;
  }
  return {
    slug: vendor.slug,
    signedUp,
    paid: rewards.length,
    monthsRedeemed,
    monthsBanked,
    monthsLeftThisYear: Math.max(0, REFERRAL_REWARD_CAP_PER_YEAR - monthsLastYear),
  };
}
