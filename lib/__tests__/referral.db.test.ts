/**
 * Store-to-store referrals (lib/referral-server.ts) — DB integration test.
 * Runs only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never
 * production); see lib/__tests__/drops.db.test.ts for the recipe, or
 * `npm run test:referrals:db` / `npm run test:drops:db`.
 *
 * Earning goes through the real `recordSubscriptionEvent` (ledger + vendor
 * patch + reward in one transaction), so replay idempotency is the real one.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REFERRAL_MONTH_DAYS, REFERRAL_REWARD_CAP_PER_YEAR } from "@/lib/referral";
import type { SubscriptionSnapshot } from "@/lib/subscription";

const ENABLED = process.env.DROPS_DB_TEST === "1";
const DAY_MS = 86_400_000;

describe.skipIf(!ENABLED)("referral rewards — DB integration", () => {
  let prisma: PrismaClient;
  let store: typeof import("@/lib/subscription-store");
  let referral: typeof import("@/lib/referral-server");
  const vendorIds: string[] = [];
  const subIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("referral.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    ({ prisma } = await import("@/lib/prisma"));
    store = await import("@/lib/subscription-store");
    referral = await import("@/lib/referral-server");
  });

  afterAll(async () => {
    if (!prisma) return;
    if (subIds.length) {
      await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId: { in: subIds } } });
    }
    if (vendorIds.length) {
      await prisma.referralReward.deleteMany({
        where: {
          OR: [{ referrerVendorId: { in: vendorIds } }, { referredVendorId: { in: vendorIds } }],
        },
      });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
    await prisma.$disconnect();
  });

  const inDays = (n: number) => new Date(Date.now() + n * DAY_MS);

  async function seedVendor(
    opts: {
      trialEndsAt?: Date | null;
      referredByVendorId?: string | null;
      subStatus?: string | null;
      isDemo?: boolean;
    } = {},
  ) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `ref-test-${tag}`,
        name: `Referral Test ${tag}`,
        ownerName: "Test Owner",
        email: `ref-${tag}@example.test`,
        trialEndsAt: opts.trialEndsAt === undefined ? inDays(10) : opts.trialEndsAt,
        referredByVendorId: opts.referredByVendorId ?? null,
        isDemo: opts.isDemo ?? false,
        settings: { create: { razorpaySubStatus: opts.subStatus ?? null } },
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  function charged(
    vendorId: string,
    interval: "monthly" | "yearly" = "monthly",
    amountPaise = 35_282,
  ) {
    const subId = `sub_ref_${randomBytes(5).toString("hex")}`;
    subIds.push(subId);
    const sub: SubscriptionSnapshot = {
      id: subId,
      status: "active",
      mapped: { plan: "STARTER", interval },
      currentEnd: inDays(interval === "yearly" ? 365 : 30),
      startAt: new Date(),
      paidCount: 1,
    };
    const eventId = `evt_ref_${randomBytes(6).toString("hex")}`;
    return {
      eventId,
      run: () =>
        store.recordSubscriptionEvent({
          eventId,
          event: "subscription.charged",
          sub,
          vendorId,
          paymentId: `pay_ref_${randomBytes(5).toString("hex")}`,
          amountPaise,
        }),
    };
  }

  const rewardsOf = (referrerVendorId: string) =>
    prisma.referralReward.findMany({ where: { referrerVendorId }, orderBy: { earnedAt: "asc" } });

  it("resolveReferrerForSignUp ignores bad, demo and self-referring codes", async () => {
    const referrer = await seedVendor();
    const demo = await seedVendor({ isDemo: true });
    const signUp = { email: "new-cook@example.test", phone: null };
    expect(await referral.resolveReferrerForSignUp(referrer.slug.toUpperCase(), signUp)).toEqual({
      id: referrer.id,
    });
    expect(await referral.resolveReferrerForSignUp("no-such-store-zz", signUp)).toBeNull();
    expect(await referral.resolveReferrerForSignUp("bad code!", signUp)).toBeNull();
    expect(await referral.resolveReferrerForSignUp(demo.slug, signUp)).toBeNull();
    expect(
      await referral.resolveReferrerForSignUp(referrer.slug, {
        email: referrer.email!,
        phone: null,
      }),
    ).toBeNull();
  });

  it("an unreferred store's charge applies normally and earns nothing", async () => {
    const v = await seedVendor();
    expect(await charged(v.id).run()).toEqual({ kind: "applied", vendorId: v.id });
    expect(await prisma.referralReward.count({ where: { referredVendorId: v.id } })).toBe(0);
  });

  it("a trial referrer earns once and gets trialEndsAt extended; replay and a later charge do nothing", async () => {
    const trialEnd = inDays(10);
    const referrer = await seedVendor({ trialEndsAt: trialEnd });
    const referred = await seedVendor({ referredByVendorId: referrer.id });

    const first = charged(referred.id);
    expect((await first.run()).kind).toBe("applied");

    const rewards = await rewardsOf(referrer.id);
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({
      referredVendorId: referred.id,
      months: 1,
      status: "REDEEMED",
      redeemedVia: "trial_extension",
      sourceEventId: first.eventId,
    });
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(after.trialEndsAt!.getTime()).toBe(trialEnd.getTime() + REFERRAL_MONTH_DAYS * DAY_MS);

    // Same event again: ledger P2002 → duplicate, nothing else moves.
    expect(await first.run()).toEqual({ kind: "duplicate" });
    // A later charge of the same referred store: one referral pays once.
    expect((await charged(referred.id).run()).kind).toBe("applied");

    expect(await rewardsOf(referrer.id)).toHaveLength(1);
    const again = await prisma.vendor.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(again.trialEndsAt!.getTime()).toBe(after.trialEndsAt!.getTime());
  });

  it("a zero-amount charge earns nothing", async () => {
    const referrer = await seedVendor();
    const referred = await seedVendor({ referredByVendorId: referrer.id });
    expect((await charged(referred.id, "monthly", 0).run()).kind).toBe("applied");
    expect(await rewardsOf(referrer.id)).toHaveLength(0);
  });

  it("a locked referrer gets the months counted from today", async () => {
    const referrer = await seedVendor({ trialEndsAt: inDays(-20) });
    const referred = await seedVendor({ referredByVendorId: referrer.id });
    const before = Date.now();
    await charged(referred.id, "yearly").run();
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: referrer.id } });
    const ends = after.trialEndsAt!.getTime();
    expect(ends).toBeGreaterThanOrEqual(before + 2 * REFERRAL_MONTH_DAYS * DAY_MS);
    expect(ends).toBeLessThanOrEqual(Date.now() + 2 * REFERRAL_MONTH_DAYS * DAY_MS);
    expect((await rewardsOf(referrer.id))[0]).toMatchObject({ months: 2, status: "REDEEMED" });
  });

  it("a referrer with a live subscription gets the reward banked, trialEndsAt untouched", async () => {
    const trialEnd = inDays(5);
    const referrer = await seedVendor({ trialEndsAt: trialEnd, subStatus: "authenticated" });
    const referred = await seedVendor({ referredByVendorId: referrer.id });
    await charged(referred.id).run();

    const rewards = await rewardsOf(referrer.id);
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ status: "EARNED", redeemedVia: null, redeemedAt: null });
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(after.trialEndsAt!.getTime()).toBe(trialEnd.getTime());
  });

  it(`caps a referrer at ${REFERRAL_REWARD_CAP_PER_YEAR} months per rolling year`, async () => {
    // Banked (live sub), so only the ledger counts.
    const referrer = await seedVendor({ subStatus: "active" });
    // 6 yearly referrals = 12 months, exactly the cap.
    for (let i = 0; i < 6; i++) {
      const referred = await seedVendor({ referredByVendorId: referrer.id });
      await charged(referred.id, "yearly").run();
    }
    let rewards = await rewardsOf(referrer.id);
    expect(rewards.reduce((n, r) => n + r.months, 0)).toBe(REFERRAL_REWARD_CAP_PER_YEAR);

    const overCap = await seedVendor({ referredByVendorId: referrer.id });
    await charged(overCap.id).run();
    rewards = await rewardsOf(referrer.id);
    expect(rewards).toHaveLength(6);
    expect(rewards.some((r) => r.referredVendorId === overCap.id)).toBe(false);

    const summary = await referral.loadReferralSummary({ id: referrer.id, slug: referrer.slug });
    expect(summary).toEqual({
      slug: referrer.slug,
      signedUp: 7,
      paid: 6,
      monthsRedeemed: 0,
      monthsBanked: REFERRAL_REWARD_CAP_PER_YEAR,
      monthsLeftThisYear: 0,
    });
  });

  it("caps a partial reward: a yearly referral with 1 month of room earns 1", async () => {
    const referrer = await seedVendor({ subStatus: "active" });
    for (let i = 0; i < 11; i++) {
      const referred = await seedVendor({ referredByVendorId: referrer.id });
      await charged(referred.id, "monthly").run();
    }
    const last = await seedVendor({ referredByVendorId: referrer.id });
    await charged(last.id, "yearly").run();
    const reward = await prisma.referralReward.findUniqueOrThrow({
      where: { referredVendorId: last.id },
    });
    expect(reward.months).toBe(1);
  });

  it("redeemBankedRewardsAtSubscribe redeems every banked month and moves trialEndsAt", async () => {
    const trialEnd = inDays(3);
    const referrer = await seedVendor({ trialEndsAt: trialEnd, subStatus: "active" });
    for (const interval of ["monthly", "yearly"] as const) {
      const referred = await seedVendor({ referredByVendorId: referrer.id });
      await charged(referred.id, interval).run();
    }
    expect((await rewardsOf(referrer.id)).every((r) => r.status === "EARNED")).toBe(true);

    const now = new Date();
    const newEnd = await referral.redeemBankedRewardsAtSubscribe(referrer.id, now);
    expect(newEnd?.getTime()).toBe(trialEnd.getTime() + 3 * REFERRAL_MONTH_DAYS * DAY_MS);

    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(after.trialEndsAt!.getTime()).toBe(newEnd!.getTime());
    const rewards = await rewardsOf(referrer.id);
    expect(
      rewards.every((r) => r.status === "REDEEMED" && r.redeemedVia === "subscribe_start"),
    ).toBe(true);

    // Nothing left to redeem.
    expect(await referral.redeemBankedRewardsAtSubscribe(referrer.id)).toBeNull();
  });

  it("redeemBankedRewardsAtSubscribe gives a grandfathered FREE store a trial end", async () => {
    const referrer = await seedVendor({ trialEndsAt: null });
    const referred = await seedVendor({ referredByVendorId: referrer.id });
    await charged(referred.id).run();
    expect((await rewardsOf(referrer.id))[0]).toMatchObject({ status: "EARNED" });

    const now = new Date();
    const newEnd = await referral.redeemBankedRewardsAtSubscribe(referrer.id, now);
    expect(newEnd?.getTime()).toBe(now.getTime() + REFERRAL_MONTH_DAYS * DAY_MS);
  });
});
