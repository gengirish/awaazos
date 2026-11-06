/**
 * Store-to-store referrals ("Invite a seller"). Pure and client-safe; the
 * database side is lib/referral-server.ts.
 *
 * The rules, in one place:
 *
 * - **The code is the referrer's store slug.** Links are
 *   `/sign-up?ref=<slug>`. A store that changes its link retires links shared
 *   under the old one (same as the store link itself); the storefront footer
 *   always carries the current slug.
 * - **Attribution is set once, at sign-up** (`Vendor.referredByVendorId`) and
 *   never changed. A referrer that is inactive or a demo store, or that shares
 *   the new account's email or phone, is ignored silently — sign-up never
 *   fails because of a referral code.
 * - **The referred store gets a longer trial**: `REFERRED_TRIAL_DAYS` instead
 *   of `TRIAL_DAYS`. Nothing else.
 * - **The referrer earns only when money comes in**: the referred store's
 *   first `subscription.charged` with a positive amount earns one
 *   `ReferralReward` (`rewardMonthsFor`: 1 month, 2 when it paid yearly).
 *   Unique on the referred store, so a referral pays at most once.
 *   Capped at `REFERRAL_REWARD_CAP_PER_YEAR` months per referrer per rolling
 *   365 days; past the cap nothing is recorded.
 * - **No cash, ever.** A reward is free STARTER time, never a payout (no TDS,
 *   no GST on commission, no payout rails).
 * - **Redemption, no timers** (`redemptionFor`):
 *     - referrer with no live subscription, on the trial or locked → applied
 *       at once by moving `trialEndsAt` forward (`extendTrialEndsAt`);
 *     - referrer with a live subscription, or a grandfathered FREE store
 *       (`trialEndsAt` null, never locked) → banked as EARNED and applied at
 *       their next subscribe, which moves `trialEndsAt` forward first so the
 *       existing "first charge at trial end" `start_at` picks it up.
 * - **Free months for a paying store** (`creditForCharge`): Razorpay can't skip
 *   or discount a UPI AutoPay charge (UPI subscriptions can't be updated, and
 *   an offer must leave more than ₹1), so a banked month is paid back instead.
 *   The referrer's next `subscription.charged` goes through as usual, uses
 *   banked months oldest first and is refunded: in full for a monthly charge,
 *   1/12 of it per month for a yearly one (up to 12). Recorded as a
 *   `ReferralCredit` in the charge's transaction; the refund itself runs after
 *   commit and is retried from /admin/referrals if Razorpay refuses it. A
 *   charge refunded in full is not money in, so it earns no reward for that
 *   store's own referrer.
 * - Demo and inactive stores never earn, demo stores never give rewards, and a store claimed from a demo
 *   (founder-sourced) is never attributed.
 */

import type { BillingAccess } from "@/lib/plan";

/** Trial length for a store that signed up through a referral link. */
export const REFERRED_TRIAL_DAYS = 60;

/** One reward month, in days. Trial extensions add this many days per month. */
export const REFERRAL_MONTH_DAYS = 30;

/** Most reward months one referrer can earn in any rolling 365 days. */
export const REFERRAL_REWARD_CAP_PER_YEAR = 12;

/** Query parameter on the sign-up page that carries the code. */
export const REFERRAL_QUERY_PARAM = "ref";

/** localStorage key the sign-up page keeps the code under (per device, 30 days). */
export const REFERRAL_STORAGE_KEY = "awz_ref";
export const REFERRAL_STORAGE_TTL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalises a `?ref=` value to a candidate slug, or null when it can't be one. */
export function parseReferralCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  if (code.length < 3 || code.length > 60) return null;
  if (!/^[a-z0-9-]+$/.test(code)) return null;
  return code;
}

/** Path of the sign-up page with this store's code: `/sign-up?ref=<slug>`. */
export function referralSignUpPath(slug: string): string {
  return `/sign-up?${REFERRAL_QUERY_PARAM}=${encodeURIComponent(slug)}`;
}

/** Absolute referral link for sharing. `origin` has no trailing slash. */
export function referralSignUpUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}${referralSignUpPath(slug)}`;
}

/** Months a referrer earns for the referred store's first charge. */
export function rewardMonthsFor(interval: "monthly" | "yearly"): number {
  return interval === "yearly" ? 2 : 1;
}

/** Months still earnable under the yearly cap, given months earned in the last 365 days. */
export function monthsUnderCap(monthsEarnedLastYear: number, wanted: number): number {
  const room = Math.max(0, REFERRAL_REWARD_CAP_PER_YEAR - monthsEarnedLastYear);
  return Math.min(room, wanted);
}

export type ReferralRedemption =
  /** Apply now: move `trialEndsAt` forward. */
  | { kind: "extend_trial" }
  /** Keep as EARNED; applied at the next subscribe. */
  | { kind: "bank"; reason: "live_subscription" | "free_store" };

/**
 * How a freshly earned reward is applied, from the referrer's billing state.
 * `hasLiveSubscription` = `VendorSettings.razorpaySubStatus` is in
 * `LIVE_SUBSCRIPTION_STATUSES` (a sub that will charge, even one scheduled
 * for a trial's end — moving `trialEndsAt` would not move its charge).
 */
export function redemptionFor(
  access: BillingAccess,
  hasLiveSubscription: boolean,
): ReferralRedemption {
  if (hasLiveSubscription || access.kind === "paid") {
    return { kind: "bank", reason: "live_subscription" };
  }
  if (access.kind === "free") return { kind: "bank", reason: "free_store" };
  return { kind: "extend_trial" };
}

/**
 * New `trialEndsAt` after adding `months` reward months: counted from the
 * later of now and the current trial end, so a locked store gets the full
 * months from today and a store on the trial keeps the days it has left.
 */
export function extendTrialEndsAt(
  trialEndsAt: Date | null,
  months: number,
  now: Date = new Date(),
): Date {
  const base = trialEndsAt && trialEndsAt.getTime() > now.getTime() ? trialEndsAt : now;
  return new Date(base.getTime() + months * REFERRAL_MONTH_DAYS * DAY_MS);
}

/** Trial end for a new store: longer when it came through a referral. */
export function signUpTrialEndsAt(referred: boolean, trialDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + (referred ? REFERRED_TRIAL_DAYS : trialDays) * DAY_MS);
}

/**
 * True when the new account and the referrer look like the same person
 * (self-referral). Emails compare case-insensitively; phones as E.164.
 */
export function isSelfReferral(
  referrer: { email: string | null; phone: string | null },
  signUp: { email: string; phone: string | null | undefined },
): boolean {
  if (referrer.email && referrer.email.trim().toLowerCase() === signUp.email.trim().toLowerCase()) {
    return true;
  }
  if (referrer.phone && signUp.phone && referrer.phone === signUp.phone) return true;
  return false;
}

/**
 * How this store would receive a reward earned today:
 * - `free_time`: added to its trial at once (on the trial or locked, nothing live);
 * - `refund`: it has a live subscription, so its next charge is refunded;
 * - `next_subscribe`: no charge is coming (grandfathered FREE, or a paid plan
 *   cancelled at period end), so it waits for the next subscribe.
 */
export type ReferralDelivery = "free_time" | "refund" | "next_subscribe";

export function referralDeliveryFor(access: BillingAccess, hasLiveSubscription: boolean): ReferralDelivery {
  if (hasLiveSubscription) return "refund";
  return redemptionFor(access, false).kind === "extend_trial" ? "free_time" : "next_subscribe";
}

/**
 * Whether to advertise the program to this store: an OWNER of a real store
 * that would get the reward soon, as free time or as a refund. A store with no
 * charge coming would only bank months, so "free months" would oversell it.
 */
export function canPromoteReferrals(input: {
  role: string;
  isDemo: boolean;
  access: BillingAccess;
  hasLiveSubscription: boolean;
}): boolean {
  if (input.role !== "OWNER" || input.isDemo) return false;
  return referralDeliveryFor(input.access, input.hasLiveSubscription) !== "next_subscribe";
}

/** The one line that sells the program, wherever it is advertised. */
export function referralPitch(delivery: ReferralDelivery = "free_time"): string {
  const month = `${rewardMonthsFor("monthly")} free month`;
  const reward =
    delivery === "refund" ? `${month} when they subscribe, refunded from your next charge` : `${month} when they subscribe`;
  return `Invite another seller. They get ${REFERRED_TRIAL_DAYS} days free, and you get ${reward}.`;
}

/** Most months one yearly charge can pay back: all twelve of them. */
const MONTHS_PER_YEAR = 12;

/**
 * What a paying referrer gets back from one of its own charges, given the
 * months it has banked. Null when nothing is banked or the charge is nothing.
 * A monthly charge uses one month and is refunded in full; a yearly charge
 * uses up to 12 and gives back 1/12 of itself per month, rounded down.
 */
export function creditForCharge(input: {
  chargePaise: number;
  interval: "monthly" | "yearly";
  monthsBanked: number;
}): { months: number; refundPaise: number } | null {
  if (!Number.isInteger(input.chargePaise) || input.chargePaise <= 0 || input.monthsBanked <= 0) return null;
  if (input.interval === "monthly") return { months: 1, refundPaise: input.chargePaise };
  const months = Math.min(input.monthsBanked, MONTHS_PER_YEAR);
  return { months, refundPaise: Math.floor((input.chargePaise * months) / MONTHS_PER_YEAR) };
}

/**
 * Takes `wanted` months from banked rewards, oldest first. Returns each touched
 * reward's new `monthsUsed` and whether it is now used up.
 */
export function takeBankedMonths(
  rewards: readonly { id: string; months: number; monthsUsed: number }[],
  wanted: number,
): { id: string; monthsUsed: number; usedUp: boolean }[] {
  const out: { id: string; monthsUsed: number; usedUp: boolean }[] = [];
  let left = wanted;
  for (const r of rewards) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, r.months - r.monthsUsed));
    if (take === 0) continue;
    left -= take;
    const monthsUsed = r.monthsUsed + take;
    out.push({ id: r.id, monthsUsed, usedUp: monthsUsed >= r.months });
  }
  return out;
}

/** What Settings → Refer a seller shows. Counts only; never the referred stores' contact details. */
export type ReferralSummary = {
  slug: string;
  /** Stores that signed up with this store's link. */
  signedUp: number;
  /** Of those, stores whose first payment earned a reward (capped ones are not counted). */
  paid: number;
  /** Reward months applied as free time. */
  monthsRedeemed: number;
  /** Reward months banked for the next subscribe. */
  monthsBanked: number;
  /** Months still earnable in the current rolling year. */
  monthsLeftThisYear: number;
};
