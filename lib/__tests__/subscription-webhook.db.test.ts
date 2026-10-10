/**
 * POST /api/webhooks/razorpay (platform subscriptions) — DB integration test.
 * Runs only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never
 * production); see lib/__tests__/drops.db.test.ts for the recipe, or
 * `npm run test:drops:db`.
 *
 * Bodies are signed with a per-run secret, so HMAC verification is real.
 */
import crypto, { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const SECRET = "whsec_db_test";
const PLAN_MONTHLY = "plan_dbtest_monthly";
const PLAN_YEARLY = "plan_dbtest_yearly";

describe.skipIf(!ENABLED)("Razorpay subscription webhook — DB integration", () => {
  let prisma: PrismaClient;
  let route: typeof import("@/app/api/webhooks/razorpay/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("subscription-webhook.db.test refuses to run against a non-local DATABASE_URL");
    }
    // Rate limiters must stay local (fail-open) — never reach a real Upstash.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    process.env.RAZORPAY_PLAN_STARTER_MONTHLY = PLAN_MONTHLY;
    process.env.RAZORPAY_PLAN_STARTER_YEARLY = PLAN_YEARLY;
    ({ prisma } = await import("@/lib/prisma"));
    route = await import("@/app/api/webhooks/razorpay/route");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId: { startsWith: "sub_dbtest_" } } });
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.$disconnect();
  });

  async function seedVendor(subId: string | null = null) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `sub-test-${tag}`,
        name: `Sub Test ${tag}`,
        ownerName: "Test Owner",
        settings: { create: { razorpaySubId: subId } },
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  const unix = (d: Date) => Math.floor(d.getTime() / 1000);
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
  const newSubId = () => `sub_dbtest_${randomBytes(5).toString("hex")}`;
  const newEventId = () => `evt_dbtest_${randomBytes(6).toString("hex")}`;

  function body(
    event: string,
    sub: Record<string, unknown>,
    payment?: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      entity: "event",
      event,
      contains: payment ? ["subscription", "payment"] : ["subscription"],
      payload: {
        subscription: { entity: { entity: "subscription", ...sub } },
        ...(payment ? { payment: { entity: { entity: "payment", ...payment } } } : {}),
      },
      created_at: unix(new Date()),
    });
  }

  function deliver(raw: string, eventId: string | null, signature?: string) {
    const sig = signature ?? crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
    const headers: Record<string, string> = { "content-type": "application/json", "x-razorpay-signature": sig };
    if (eventId) headers["x-razorpay-event-id"] = eventId;
    return route.POST(
      new NextRequest("http://localhost/api/webhooks/razorpay", { method: "POST", body: raw, headers }),
    );
  }

  it("rejects a bad signature before touching the DB", async () => {
    const v = await seedVendor();
    const subId = newSubId();
    const raw = body("subscription.charged", { id: subId, plan_id: PLAN_MONTHLY, status: "active", notes: { vendorId: v.id } });
    const res = await deliver(raw, newEventId(), "00".repeat(32));
    expect(res.status).toBe(401);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: subId } })).toBe(0);
  });

  it("charged sets STARTER until current_end and records the payment once, even when replayed", async () => {
    const v = await seedVendor();
    const subId = newSubId();
    const end = inDays(30);
    const raw = body(
      "subscription.charged",
      { id: subId, plan_id: PLAN_MONTHLY, status: "active", current_end: unix(end), paid_count: 1, notes: { vendorId: v.id } },
      { id: "pay_dbtest_1", amount: 35282, email: "never-stored@example.test", contact: "+919876543210" },
    );
    const eventId = newEventId();

    expect((await deliver(raw, eventId)).status).toBe(200);
    expect((await deliver(raw, eventId)).status).toBe(200); // Razorpay retry

    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, include: { settings: true } });
    expect(vendor.plan).toBe("STARTER");
    expect(vendor.planExpiresAt?.getTime()).toBe(unix(end) * 1000);
    expect(vendor.settings?.razorpaySubId).toBe(subId);
    expect(vendor.settings?.razorpaySubStatus).toBe("active");
    expect(vendor.settings?.billingInterval).toBe("monthly");

    const rows = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: v.id, paymentId: "pay_dbtest_1", amountPaise: 35282, event: "subscription.charged" });
    // The ledger has no column for buyer contact details, and none leak into it.
    expect(JSON.stringify(rows[0])).not.toMatch(/never-stored|9876543210/);
  });

  it("the same charge delivered under two event ids doesn't extend twice", async () => {
    const v = await seedVendor();
    const subId = newSubId();
    const end = inDays(30);
    const raw = body("subscription.charged", {
      id: subId, plan_id: PLAN_MONTHLY, status: "active", current_end: unix(end), notes: { vendorId: v.id },
    });
    await deliver(raw, newEventId());
    await deliver(raw, newEventId());
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(vendor.planExpiresAt?.getTime()).toBe(unix(end) * 1000);
  });

  it("dedupes on the signed body when the event-id header is missing", async () => {
    const v = await seedVendor();
    const subId = newSubId();
    const raw = body("subscription.activated", {
      id: subId, plan_id: PLAN_YEARLY, status: "active", current_end: unix(inDays(365)), notes: { vendorId: v.id },
    });
    await deliver(raw, null);
    await deliver(raw, null);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: subId } })).toBe(1);
    const s = await prisma.vendorSettings.findUniqueOrThrow({ where: { vendorId: v.id } });
    expect(s.billingInterval).toBe("yearly");
  });

  it("cancelled keeps the paid period and clears the sub id", async () => {
    const subId = newSubId();
    const v = await seedVendor(subId);
    const end = inDays(12);
    await prisma.vendor.update({ where: { id: v.id }, data: { plan: "STARTER", planExpiresAt: end } });
    const raw = body("subscription.cancelled", {
      id: subId, plan_id: PLAN_MONTHLY, status: "cancelled", paid_count: 3, notes: { vendorId: v.id },
    });
    expect((await deliver(raw, newEventId())).status).toBe(200);
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, include: { settings: true } });
    expect(vendor.plan).toBe("STARTER");
    expect(vendor.planExpiresAt?.getTime()).toBe(end.getTime());
    expect(vendor.settings?.razorpaySubId).toBeNull();
    expect(vendor.settings?.razorpaySubStatus).toBe("cancelled");
  });

  it("finds the vendor by stored sub id when notes are missing", async () => {
    const subId = newSubId();
    const v = await seedVendor(subId);
    const raw = body("subscription.halted", { id: subId, plan_id: PLAN_MONTHLY, status: "halted" });
    expect((await deliver(raw, newEventId())).status).toBe(200);
    const s = await prisma.vendorSettings.findUniqueOrThrow({ where: { vendorId: v.id } });
    expect(s.razorpaySubStatus).toBe("halted");
  });

  it("records an event for an unknown vendor without failing", async () => {
    const subId = newSubId();
    const raw = body("subscription.charged", {
      id: subId, plan_id: PLAN_MONTHLY, status: "active", current_end: unix(inDays(30)), notes: { vendorId: "no-such-vendor" },
    });
    expect((await deliver(raw, newEventId())).status).toBe(200);
    const rows = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorId).toBeNull();
  });

  it("acknowledges non-subscription events without recording them", async () => {
    const subId = newSubId();
    const raw = JSON.stringify({ event: "payment.captured", payload: { subscription: { entity: { id: subId } } } });
    expect((await deliver(raw, newEventId())).status).toBe(200);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: subId } })).toBe(0);
  });
});
