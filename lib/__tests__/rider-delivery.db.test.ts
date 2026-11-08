/**
 * Rider "Delivered" link and the buyer's "I've received my order" — DB
 * integration test. Runs only with DROPS_DB_TEST=1 against a THROWAWAY
 * Postgres (never production); recipe in lib/__tests__/drops.db.test.ts.
 *
 * Drives the real public routes (POST /api/d/[token],
 * POST /api/s/[slug]/orders/[token]/received) and the vendor PATCH route,
 * with requireVendorRole mocked to "signed in as <vendor>".
 */
import { randomBytes } from "node:crypto";

import type { Vendor } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

vi.hoisted(() => {
  // Rate limiters must stay local (fail-open) — never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

const auth = vi.hoisted(() => ({ vendor: null as unknown }));

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
      if (!auth.vendor) throw new AuthError(401, "Unauthorized");
      return { user: {}, staff: { role: "OWNER" }, vendor: auth.vendor, setVendorCookie: null };
    }),
  };
});

type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("rider link + buyer received — DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let menuOrders: typeof import("@/lib/menu-orders");
  let riderRoute: typeof import("@/app/api/d/[token]/route");
  let receivedRoute: typeof import("@/app/api/s/[slug]/orders/[token]/received/route");
  let itemRoute: typeof import("@/app/api/storefront-orders/[orderId]/route");
  let rider: typeof import("@/lib/rider-delivery");
  let todayStart: Date;
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("rider-delivery.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    menuOrders = await import("@/lib/menu-orders");
    riderRoute = await import("@/app/api/d/[token]/route");
    receivedRoute = await import("@/app/api/s/[slug]/orders/[token]/received/route");
    itemRoute = await import("@/app/api/storefront-orders/[orderId]/route");
    rider = await import("@/lib/rider-delivery");
    todayStart = (await import("@/lib/billing-period")).getIstTodayStart();
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedVendor() {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `rider-${tag}`,
        name: `Rider Kitchen ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        upiId: "kitchen@upi",
        settings: {
          create: {
            publishStorefront: true,
            acceptPayOnDelivery: true,
            acceptMenuOrders: true,
            menuFulfilmentMode: "BOTH",
          },
        },
        menuItems: { create: [{ name: "Ragi Laddu", priceInPaise: 15000 }] },
      },
      include: { menuItems: true },
    });
    vendorIds.push(v.id);
    return v;
  }

  async function order(
    v: Awaited<ReturnType<typeof seedVendor>>,
    paymentMethod: "UPI" | "CASH",
    fulfilmentType: "DELIVERY" | "PICKUP" = "DELIVERY",
  ) {
    const r = await menuOrders.placeMenuOrder({
      vendor: { id: v.id, plan: v.plan },
      settings: { acceptMenuOrders: true, acceptPayOnDelivery: true, menuFulfilmentMode: "BOTH", menuDeliveryFeePaise: 0 },
      items: [{ menuItemId: v.menuItems[0]!.id, qty: 2 }],
      customerName: "Asha Rao",
      customerPhone: "+919848054321",
      fulfilmentType,
      deliveryAddress: fulfilmentType === "DELIVERY" ? "12 Lake Road, Yelahanka" : null,
      paymentMethod,
    });
    if (!r.ok) throw new Error(`order failed: ${r.error.code}`);
    return prisma.transaction.findUniqueOrThrow({ where: { id: r.order.id } });
  }

  const as = (v: Vendor | null) => {
    auth.vendor = v;
  };
  const tapDelivered = (token: string) =>
    riderRoute.POST(new Request(`http://localhost/api/d/${token}`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
  const tapReceived = (slug: string, token: string) =>
    receivedRoute.POST(new Request(`http://localhost/api/s/${slug}/orders/${token}/received`, { method: "POST" }), {
      params: Promise.resolve({ slug, token }),
    });
  const patch = (orderId: string, action: string) =>
    itemRoute.PATCH(
      new NextRequest(`http://localhost/api/storefront-orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ orderId }) },
    );
  const summary = (vendorId: string) =>
    prisma.dailySummary.findUnique({ where: { vendorId_date: { vendorId, date: todayStart } } });

  it("delivery orders get a rider token distinct from the order token; pickups get none", async () => {
    const v = await seedVendor();
    const d = await order(v, "CASH");
    expect(d.riderToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(d.riderToken).not.toBe(d.orderToken);
    expect((await order(v, "CASH", "PICKUP")).riderToken).toBeNull();
  });

  it("an older delivery without a token gets one on confirm, and keeps it", async () => {
    const v = await seedVendor();
    const d = await order(v, "CASH");
    await prisma.transaction.update({ where: { id: d.id }, data: { riderToken: null } });
    as(v);
    expect((await patch(d.id, "confirm")).status).toBe(200);
    const minted = (await prisma.transaction.findUniqueOrThrow({ where: { id: d.id } })).riderToken;
    expect(minted).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await patch(d.id, "dispatch")).status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: d.id } })).riderToken).toBe(minted);
  });

  it("rider page shows the door details while live; Delivered collects cash once; then no buyer details", async () => {
    const v = await seedVendor();
    const d = await order(v, "CASH");
    const live = await rider.loadRiderOrder(d.riderToken!);
    expect(live).toMatchObject({
      state: "live",
      customerName: "Asha Rao",
      customerPhone: "+919848054321",
      deliveryAddress: "12 Lake Road, Yelahanka",
      totalPaise: 30000,
    });

    const res = await tapDelivered(d.riderToken!);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { state: "delivered" } });
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: d.id } });
    expect(after).toMatchObject({ fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" });
    expect(await summary(v.id)).toMatchObject({ totalRevenuePaise: 30000, cashRevenuePaise: 30000 });

    // A second tap changes nothing and never double-credits.
    expect((await tapDelivered(d.riderToken!)).status).toBe(409);
    expect(await summary(v.id)).toMatchObject({ totalRevenuePaise: 30000 });

    const done = await rider.loadRiderOrder(d.riderToken!);
    expect(done?.state).toBe("delivered");
    expect(JSON.stringify(done)).not.toMatch(/Asha|9848054321|Lake Road/);
  });

  it("unknown, malformed, buyer-order and cancelled tokens can't deliver", async () => {
    const v = await seedVendor();
    const d = await order(v, "CASH");
    expect((await tapDelivered(randomBytes(24).toString("base64url"))).status).toBe(404);
    expect((await tapDelivered("short")).status).toBe(404);
    // The buyer's own token is not a rider link.
    expect((await tapDelivered(d.orderToken!)).status).toBe(404);

    as(v);
    expect((await patch(d.id, "cancel")).status).toBe(200);
    expect((await tapDelivered(d.riderToken!)).status).toBe(409);
    expect((await rider.loadRiderOrder(d.riderToken!))?.state).toBe("cancelled");
  });

  it("buyer received: unpaid cash only records the tap; a paid order is delivered", async () => {
    const v = await seedVendor();
    as(v);

    const cash = await order(v, "CASH");
    // Not confirmed yet is fine (a bulk delivery may skip the board); the stamp is what counts.
    const r1 = await tapReceived(v.slug, cash.orderToken!);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ data: { delivered: false } });
    const c = await prisma.transaction.findUniqueOrThrow({ where: { id: cash.id } });
    expect(c.buyerReceivedAt).not.toBeNull();
    expect(c).toMatchObject({ fulfilmentStatus: "PLACED", paymentStatus: "PENDING" });
    expect(await summary(v.id)).toBeNull(); // a buyer's tap never books cash
    expect((await tapReceived(v.slug, cash.orderToken!)).status).toBe(409);

    const upi = await order(v, "UPI");
    expect((await patch(upi.id, "mark_paid")).status).toBe(200);
    const r2 = await tapReceived(v.slug, upi.orderToken!);
    expect(await r2.json()).toEqual({ data: { delivered: true } });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: upi.id } })).fulfilmentStatus).toBe("DELIVERED");
  });

  it("buyer received refuses pickups, other stores' slugs and unknown tokens", async () => {
    const v = await seedVendor();
    const w = await seedVendor();
    const pickup = await order(v, "CASH", "PICKUP");
    expect((await tapReceived(v.slug, pickup.orderToken!)).status).toBe(409);
    const d = await order(v, "CASH");
    expect((await tapReceived(w.slug, d.orderToken!)).status).toBe(404);
    expect((await tapReceived(v.slug, randomBytes(24).toString("base64url"))).status).toBe(404);
  });
});
