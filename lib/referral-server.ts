/**
 * Database side of store-to-store referrals. Rules and their reasons are in
 * the header of lib/referral.ts; read it first. Server-only.
 */
import type { Prisma } from "@prisma/client";

import { billingAccess, type BillingAccess } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import {
  canPromoteReferrals,
  creditForCharge,
  extendTrialEndsAt,
  isSelfReferral,
  monthsUnderCap,
  parseReferralCode,
  redemptionFor,
  referralDeliveryFor,
  REFERRAL_REWARD_CAP_PER_YEAR,
  rewardMonthsFor,
  takeBankedMonths,
  type ReferralDelivery,
  type ReferralSummary,
} from "@/lib/referral";
import { getRazorpay } from "@/lib/razorpay";
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
 * The orders board's prompt: a store that would get the reward soon, has its
 * store published (something to show the seller it invites) and has no invite
 * yet. Returns how the reward would reach it (for the wording), or null.
 * Read on page render only.
 */
export async function shouldAskToRefer(input: {
  vendor: { id: string; isDemo: boolean };
  role: string;
  access: BillingAccess;
  published: boolean;
  razorpaySubStatus: string | null | undefined;
}): Promise<ReferralDelivery | null> {
  const hasLiveSubscription = LIVE_SUBSCRIPTION_STATUSES.includes(input.razorpaySubStatus ?? "");
  if (!input.published) return null;
  if (!canPromoteReferrals({ role: input.role, isDemo: input.vendor.isDemo, access: input.access, hasLiveSubscription })) {
    return null;
  }
  const invited = await prisma.vendor.count({ where: { referredByVendorId: input.vendor.id } });
  return invited === 0 ? referralDeliveryFor(input.access, hasLiveSubscription) : null;
}

/**
 * Called inside `recordSubscriptionEvent`'s transaction (which already holds
 * the vendor's row lock) for the store's own `subscription.charged`. When it
 * has banked months, uses them (`creditForCharge`, oldest reward first) and
 * records the refund owed as a PENDING `ReferralCredit`. Nothing is sent to
 * Razorpay here; `settleReferralCredit` does that after commit.
 */
export async function claimReferralCreditInTx(
  tx: Tx,
  input: {
    vendorId: string;
    sourceEventId: string;
    paymentId: string | null | undefined;
    chargePaise: number;
    interval: BillingInterval;
    now?: Date;
  },
): Promise<{ creditId: string; refundPaise: number; created: boolean } | null> {
  if (!input.paymentId) return null;
  const now = input.now ?? new Date();
  // Checked first: a second event naming the same payment must not hit the
  // unique index (which would roll back the whole charge), and must still see
  // that this payment is being paid back.
  const existing = await tx.referralCredit.findUnique({
    where: { paymentId: input.paymentId },
    select: { id: true, refundPaise: true },
  });
  if (existing) return { creditId: existing.id, refundPaise: existing.refundPaise, created: false };

  const banked = await tx.referralReward.findMany({
    where: { referrerVendorId: input.vendorId, status: "EARNED" },
    orderBy: { earnedAt: "asc" },
    select: { id: true, months: true, monthsUsed: true },
  });
  const monthsBanked = banked.reduce((n, r) => n + Math.max(0, r.months - r.monthsUsed), 0);
  const credit = creditForCharge({ chargePaise: input.chargePaise, interval: input.interval, monthsBanked });
  if (!credit || credit.refundPaise <= 0) return null;

  for (const r of takeBankedMonths(banked, credit.months)) {
    await tx.referralReward.updateMany({
      where: { id: r.id, referrerVendorId: input.vendorId, status: "EARNED" },
      data: r.usedUp
        ? { monthsUsed: r.monthsUsed, status: "REDEEMED", redeemedVia: "charge_refund", redeemedAt: now }
        : { monthsUsed: r.monthsUsed },
    });
  }
  const row = await tx.referralCredit.create({
    data: {
      vendorId: input.vendorId,
      paymentId: input.paymentId,
      sourceEventId: input.sourceEventId,
      chargePaise: input.chargePaise,
      refundPaise: credit.refundPaise,
      months: credit.months,
      createdAt: now,
    },
    select: { id: true },
  });
  return { creditId: row.id, refundPaise: credit.refundPaise, created: true };
}

export type SettleReferralCreditResult =
  | { kind: "refunded" }
  | { kind: "not_found" }
  | { kind: "failed"; error: string };

/** Razorpay's own error text, kept short. It describes the call, never a buyer. */
function razorpayErrorText(e: unknown): string {
  const desc = (e as { error?: { description?: unknown } } | null)?.error?.description;
  const text = typeof desc === "string" ? desc : e instanceof Error ? e.message : "unknown error";
  return text.slice(0, 200);
}

/**
 * Sends the refund for a PENDING credit. Safe to call more than once, and from
 * two places at the same time: the row is locked for the whole attempt, and a
 * refund Razorpay already holds for this credit (`notes.referralCreditId`) is
 * recorded instead of refunding again. Never throws: a refusal (for example a
 * low Razorpay balance) is kept in `lastError` for /admin/referrals to retry.
 */
export async function settleReferralCredit(creditId: string): Promise<SettleReferralCreditResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM referral_credits WHERE id = ${creditId} FOR UPDATE`;
        if (locked.length === 0) return { kind: "not_found" as const };
        const credit = await tx.referralCredit.findUniqueOrThrow({
          where: { id: creditId },
          select: { id: true, paymentId: true, refundPaise: true, status: true },
        });
        if (credit.status === "REFUNDED") return { kind: "refunded" as const };

        const razorpay = getRazorpay();
        const refunds = await razorpay.payments.fetchMultipleRefund(credit.paymentId, { count: 100 });
        const earlier = refunds.items.find((r) => r.notes?.referralCreditId === credit.id);
        const refund =
          earlier ??
          (await razorpay.payments.refund(credit.paymentId, {
            amount: credit.refundPaise,
            speed: "normal",
            notes: { referralCreditId: credit.id, reason: "referral_free_month" },
          }));
        await tx.referralCredit.update({
          where: { id: credit.id },
          data: { status: "REFUNDED", razorpayRefundId: refund.id, refundedAt: new Date(), lastError: null },
        });
        return { kind: "refunded" as const };
      },
      { timeout: 20_000 },
    );
  } catch (e) {
    const error = razorpayErrorText(e);
    console.warn("[referral] refund for credit %s failed: %s", creditId, error);
    await prisma.referralCredit
      .updateMany({ where: { id: creditId, status: "PENDING" }, data: { lastError: error } })
      .catch(() => undefined);
    return { kind: "failed", error };
  }
}

/** The webhook's hook: settles the credit a charge event recorded, if any. Never throws. */
export async function settleReferralCreditForEvent(sourceEventId: string): Promise<void> {
  const credit = await prisma.referralCredit
    .findUnique({ where: { sourceEventId }, select: { id: true, status: true } })
    .catch(() => null);
  if (credit && credit.status === "PENDING") await settleReferralCredit(credit.id);
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
      select: { id: true, months: true, monthsUsed: true },
    });
    if (banked.length === 0) return null;
    // Months a refund already used are not given twice.
    const months = banked.reduce((n, r) => n + Math.max(0, r.months - r.monthsUsed), 0);
    if (months === 0) return null;
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
      select: { months: true, monthsUsed: true, status: true, earnedAt: true },
    }),
  ]);
  let monthsRedeemed = 0;
  let monthsBanked = 0;
  let monthsLastYear = 0;
  const yearAgo = now.getTime() - YEAR_MS;
  for (const r of rewards) {
    if (r.status === "REDEEMED") monthsRedeemed += r.months;
    else {
      monthsRedeemed += r.monthsUsed;
      monthsBanked += Math.max(0, r.months - r.monthsUsed);
    }
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
