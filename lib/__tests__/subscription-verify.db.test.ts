/**
 * POST /api/razorpay/verify-subscription — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 *
 * The signature check and every write are real. Only the session
 * (requireVendorRole) and the Razorpay fetch are stubbed.
 */
import crypto, { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const KEY_SECRET = "key_secret_db_test";
const PLAN_MONTHLY = "plan_verify_monthly";

const h = vi.hoisted(() => {
  // Rate limiters must stay local (fail-open) — never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    auth: null as null | { vendorId: string },
    fetchSubscription: vi.fn(),
  };
});

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    requireVendorRole: vi.fn(async () => {
      if (!h.auth) throw new AuthError(401, "Unauthorized");
      return { vendor: { id: h.auth.vendorId }, staff: { role: "OWNER" }, setVendorCookie: null };
    }),
  };
});

vi.mock("@/lib/razorpay", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/razorpay")>();
  return { ...real, fetchSubscription: h.fetchSubscription };
});

describe.skipIf(!ENABLED)("verify-subscription route — DB integration", () => {
  let prisma: PrismaClient;
  let route: typeof import("@/app/api/razorpay/verify-subscription/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("subscription-verify.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_PLAN_STARTER_MONTHLY = PLAN_MONTHLY;
    ({ prisma } = await import("@/lib/prisma"));
    route = await import("@/app/api/razorpay/verify-subscription/route");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId: { startsWith: "sub_vfy_" } } });
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.auth = null;
    h.fetchSubscription.mockReset();
  });

  const unix = (d: Date) => Math.floor(d.getTime() / 1000);
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
  const newSubId = () => `sub_vfy_${randomBytes(5).toString("hex")}`;
  const newPayId = () => `pay_vfy_${randomBytes(5).toString("hex")}`;
  const sign = (payId: string, subId: string) =>
    crypto.createHmac("sha256", KEY_SECRET).update(`${payId}|${subId}`, "utf8").digest("hex");

  /** A vendor whose trial has ended (locked), with `subId` on file as an unpaid checkout. */
  async function seedLocked(subId: string | null, trialEndsAt: Date = inDays(-1)) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `vfy-test-${tag}`,
        name: `Verify Test ${tag}`,
        ownerName: "Test Owner",
        trialEndsAt,
        settings: { create: { razorpaySubId: subId, razorpaySubStatus: subId ? "created" : null } },
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  function post(body: unknown) {
    return route.POST(
      new NextRequest("http://localhost/api/razorpay/verify-subscription", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
  }

  const success = (payId: string, subId: string, signature = sign(payId, subId)) => ({
    razorpay_payment_id: payId,
    razorpay_subscription_id: subId,
    razorpay_signature: signature,
  });

  it("401 without a session", async () => {
    const res = await post(success(newPayId(), newSubId()));
    expect(res.status).toBe(401);
  });

  it("an active subscription unlocks the vendor at once, and a replay changes nothing", async () => {
    const subId = newSubId();
    const payId = newPayId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    const end = inDays(30);
    h.fetchSubscription.mockResolvedValue({
      id: subId,
      plan_id: PLAN_MONTHLY,
      status: "active",
      current_end: unix(end),
      paid_count: 1,
      notes: { vendorId: v.id },
    });

    const res = await post(success(payId, subId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "active", active: true } });

    const again = await post(success(payId, subId));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ data: { status: "active", active: true } });

    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, include: { settings: true } });
    expect(vendor.plan).toBe("STARTER");
    expect(vendor.planExpiresAt?.getTime()).toBe(unix(end) * 1000);
    expect(vendor.settings?.razorpaySubStatus).toBe("active");
    expect(vendor.settings?.billingInterval).toBe("monthly");
    const rows = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: v.id, paymentId: payId, event: "subscription.activated" });
  });

  it("the webhook arriving after verify does not extend the period again", async () => {
    const subId = newSubId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    const end = inDays(30);
    const entity = {
      id: subId,
      plan_id: PLAN_MONTHLY,
      status: "active",
      current_end: unix(end),
      paid_count: 1,
      notes: { vendorId: v.id },
    };
    h.fetchSubscription.mockResolvedValue(entity);
    expect((await post(success(newPayId(), subId))).status).toBe(200);

    const { recordSubscriptionEvent } = await import("@/lib/subscription-store");
    const { toSubscriptionSnapshot } = await import("@/lib/razorpay");
    const result = await recordSubscriptionEvent({
      eventId: `evt_vfy_${randomBytes(5).toString("hex")}`,
      event: "subscription.charged",
      sub: toSubscriptionSnapshot(subId, entity),
      vendorId: v.id,
      paymentId: "pay_from_webhook",
      amountPaise: 35282,
    });
    expect(result.kind).toBe("applied");
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(vendor.planExpiresAt?.getTime()).toBe(unix(end) * 1000);
  });

  it("subscribed during the trial: authenticated with a future start grants the plan up to the first charge", async () => {
    const subId = newSubId();
    const trialEnd = inDays(12);
    const v = await seedLocked(subId, trialEnd);
    h.auth = { vendorId: v.id };
    h.fetchSubscription.mockResolvedValue({
      id: subId,
      plan_id: PLAN_MONTHLY,
      status: "authenticated",
      start_at: unix(trialEnd),
      paid_count: 0,
      notes: { vendorId: v.id },
    });
    const res = await post(success(newPayId(), subId));
    expect(await res.json()).toEqual({ data: { status: "authenticated", active: true } });
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(vendor.plan).toBe("STARTER");
    expect(vendor.planExpiresAt?.getTime()).toBe(unix(trialEnd) * 1000);
  });

  it("paid but not active yet: reports not active, then a retry applies the activation", async () => {
    const subId = newSubId();
    const payId = newPayId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    const base = { id: subId, plan_id: PLAN_MONTHLY, notes: { vendorId: v.id } };

    h.fetchSubscription.mockResolvedValueOnce({ ...base, status: "authenticated", paid_count: 0 });
    const first = await post(success(payId, subId));
    expect(await first.json()).toEqual({ data: { status: "authenticated", active: false } });
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).plan).toBe("FREE");

    h.fetchSubscription.mockResolvedValueOnce({
      ...base,
      status: "active",
      current_end: unix(inDays(30)),
      paid_count: 1,
    });
    const second = await post(success(payId, subId));
    expect(await second.json()).toEqual({ data: { status: "active", active: true } });
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).plan).toBe("STARTER");
  });

  it("400 on a bad signature, before Razorpay is asked and with nothing written", async () => {
    const subId = newSubId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    const res = await post(success(newPayId(), subId, "ab".repeat(32)));
    expect(res.status).toBe(400);
    expect(h.fetchSubscription).not.toHaveBeenCalled();
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: subId } })).toBe(0);
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).plan).toBe("FREE");
  });

  it("404 for a subscription that isn't the one on file — even with a valid signature", async () => {
    const mine = newSubId();
    const theirs = newSubId();
    const a = await seedLocked(mine);
    const b = await seedLocked(theirs);
    h.auth = { vendorId: a.id };
    const payId = newPayId();
    const res = await post(success(payId, theirs));
    expect(res.status).toBe(404);
    expect(h.fetchSubscription).not.toHaveBeenCalled();
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: b.id } })).plan).toBe("FREE");
  });

  it("404 when Razorpay says the subscription belongs to another vendor", async () => {
    const subId = newSubId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    h.fetchSubscription.mockResolvedValue({
      id: subId,
      plan_id: PLAN_MONTHLY,
      status: "active",
      current_end: unix(inDays(30)),
      notes: { vendorId: "someone-else" },
    });
    const res = await post(success(newPayId(), subId));
    expect(res.status).toBe(404);
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).plan).toBe("FREE");
  });

  it("502 when Razorpay can't be reached, with nothing written", async () => {
    const subId = newSubId();
    const v = await seedLocked(subId);
    h.auth = { vendorId: v.id };
    h.fetchSubscription.mockRejectedValue(new Error("razorpay.subscriptions.fetch exceeded 8000ms timeout"));
    const res = await post(success(newPayId(), subId));
    expect(res.status).toBe(502);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: subId } })).toBe(0);
  });

  it("400 on a malformed body", async () => {
    const v = await seedLocked(newSubId());
    h.auth = { vendorId: v.id };
    expect((await post({ razorpay_payment_id: "pay_x" })).status).toBe(400);
  });
});
