/**
 * "Order from menu" vendor side — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the docker / db push recipe.
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/storefront-orders.db.test.ts
 *
 * Drives the real route handlers (GET/PATCH /api/storefront-orders, the drop
 * PATCH route, PATCH /api/vendor) with requireVendorRole mocked to "signed in
 * as <vendor>". Orders are created with placeMenuOrder / placeStorefrontOrder.
 */
import { randomBytes } from "node:crypto";

import type { Vendor } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

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

describe.skipIf(!ENABLED)("storefront (menu) orders — vendor side, DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let menuOrders: typeof import("@/lib/menu-orders");
  let drops: typeof import("@/lib/drops");
  let listRoute: typeof import("@/app/api/storefront-orders/route");
  let itemRoute: typeof import("@/app/api/storefront-orders/[orderId]/route");
  let dropItemRoute: typeof import("@/app/api/drops/[id]/orders/[orderId]/route");
  let vendorRoute: typeof import("@/app/api/vendor/route");
  let todayStart: Date;
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("storefront-orders.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    menuOrders = await import("@/lib/menu-orders");
    drops = await import("@/lib/drops");
    listRoute = await import("@/app/api/storefront-orders/route");
    itemRoute = await import("@/app/api/storefront-orders/[orderId]/route");
    dropItemRoute = await import("@/app/api/drops/[id]/orders/[orderId]/route");
    vendorRoute = await import("@/app/api/vendor/route");
    todayStart = (await import("@/lib/billing-period")).getIstTodayStart();
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }); // cascades the rest
    }
    await prisma.$disconnect();
  });

  async function seedVendor(settings: Record<string, unknown> = {}, upiId: string | null = "kitchen@upi") {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `menu-orders-${tag}`,
        name: `Menu Orders ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        upiId,
        settings: {
          create: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true, ...settings },
        },
        menuItems: {
          create: [
            { name: "Samosa", priceInPaise: 2000 },
            { name: "Chai", priceInPaise: 1500 },
          ],
        },
      },
      include: { menuItems: { orderBy: { name: "asc" } } },
    });
    vendorIds.push(v.id);
    return v;
  }

  function menuOrder(v: Awaited<ReturnType<typeof seedVendor>>, paymentMethod: "UPI" | "CASH") {
    return menuOrders.placeMenuOrder({
      vendor: { id: v.id, plan: v.plan },
      settings: {
        acceptMenuOrders: true,
        acceptPayOnDelivery: true,
        menuFulfilmentMode: "PICKUP",
        menuDeliveryFeePaise: 0,
      },
      items: [
        { menuItemId: v.menuItems[1]!.id, qty: 2 }, // Samosa ×2 = 4000
        { menuItemId: v.menuItems[0]!.id, qty: 1 }, // Chai ×1 = 1500
      ],
      customerName: "Meera",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod,
    });
  }

  async function seedDropOrder(v: Awaited<ReturnType<typeof seedVendor>>) {
    const now = new Date();
    const drop = await prisma.drop.create({
      data: {
        vendorId: v.id,
        title: "Saturday Bakes",
        date: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now.getTime() + 2 * 86_400_000),
        fulfilmentEndsAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
        closesAt: new Date(now.getTime() + 86_400_000),
        status: "OPEN",
        // Keep the everyday menu orderable alongside this drop — these tests
        // place menu orders after seeding it (see menu-visibility.db.test.ts).
        showEverydayMenu: true,
        items: { create: [{ menuItemId: v.menuItems[0]!.id, priceInPaise: 1500, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    const r = await drops.placeStorefrontOrder({
      vendor: { id: v.id, plan: v.plan },
      acceptPayOnDelivery: true,
      dropId: drop.id,
      items: [{ dropItemId: drop.items[0]!.id, qty: 1 }],
      customerName: "Asha",
      customerPhone: "+919876543211",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
    if (!r.ok) throw new Error(`drop order failed: ${r.error.code}`);
    return { drop, orderId: r.order.id };
  }

  const as = (v: Vendor | null) => {
    auth.vendor = v;
  };
  const getList = () => listRoute.GET(new NextRequest("http://localhost/api/storefront-orders"));
  const patchMenu = (orderId: string, action: string) =>
    itemRoute.PATCH(
      new NextRequest(`http://localhost/api/storefront-orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ orderId }) },
    );
  const patchDrop = (dropId: string, orderId: string, action: string) =>
    dropItemRoute.PATCH(
      new NextRequest(`http://localhost/api/drops/${dropId}/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ id: dropId, orderId }) },
    );
  const patchVendor = (body: unknown) =>
    vendorRoute.PATCH(
      new NextRequest("http://localhost/api/vendor", { method: "PATCH", body: JSON.stringify(body) }),
    );
  const summary = (vendorId: string) =>
    prisma.dailySummary.findUnique({ where: { vendorId_date: { vendorId, date: todayStart } } });

  it("GET lists this vendor's menu and drop orders together (no other tenants), in window", async () => {
    const a = await seedVendor();
    const b = await seedVendor();
    const cash = await menuOrder(a, "CASH");
    const upi = await menuOrder(a, "UPI");
    const other = await menuOrder(b, "CASH");
    if (!cash.ok || !upi.ok || !other.ok) throw new Error("seed failed");
    const { drop, orderId: dropOrderId } = await seedDropOrder(a);
    const { drop: otherDrop, orderId: otherDropOrderId } = await seedDropOrder(b);

    // Old orders: a delivered one falls out of the window, an open cash one stays.
    const oldDone = await menuOrder(a, "CASH");
    const oldOpen = await menuOrder(a, "CASH");
    if (!oldDone.ok || !oldOpen.ok) throw new Error("seed failed");
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    await prisma.transaction.update({
      where: { id: oldDone.order.id },
      data: { createdAt: fiveDaysAgo, fulfilmentStatus: "DELIVERED" },
    });
    await prisma.transaction.update({ where: { id: oldOpen.order.id }, data: { createdAt: fiveDaysAgo } });

    as(a);
    const res = await getList();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; dropId: string | null; createdAt: string }[];
      drops: { id: string; title: string }[];
      summary: { activeOrders: number };
      signal: number | null;
    };
    const ids = body.data.map((o) => o.id);
    expect(new Set(ids)).toEqual(new Set([cash.order.id, upi.order.id, oldOpen.order.id, dropOrderId]));
    expect(ids).not.toContain(other.order.id);
    expect(ids).not.toContain(otherDropOrderId);
    expect(ids).not.toContain(oldDone.order.id);
    expect(ids[ids.length - 1]).toBe(oldOpen.order.id); // newest first
    // Each order says which drop it belongs to, and the drop comes along for the picker.
    expect(body.data.find((o) => o.id === dropOrderId)?.dropId).toBe(drop.id);
    expect(body.data.find((o) => o.id === cash.order.id)?.dropId).toBeNull();
    expect(body.drops.map((d) => d.id)).toEqual([drop.id]);
    expect(body.drops.map((d) => d.id)).not.toContain(otherDrop.id);
    expect(body.summary.activeOrders).toBe(4);
    expect(body.signal).toBeNull(); // no KV in tests
  }, 20_000);

  it("GET ?drop= keeps a past drop and all its orders on the board; another vendor's id matches nothing", async () => {
    const a = await seedVendor();
    const b = await seedVendor();
    const { drop, orderId } = await seedDropOrder(a);
    const { drop: foreign, orderId: foreignOrderId } = await seedDropOrder(b);

    // Fulfilled a fortnight ago, its order delivered: off the board by default.
    const longAgo = new Date(Date.now() - 14 * 86_400_000);
    await prisma.drop.update({
      where: { id: drop.id },
      data: { status: "FULFILLED", closesAt: longAgo, fulfilmentStartsAt: longAgo, fulfilmentEndsAt: longAgo },
    });
    await prisma.transaction.update({
      where: { id: orderId },
      data: { createdAt: longAgo, fulfilmentStatus: "DELIVERED", paymentStatus: "PAID" },
    });

    type Body = { data: { id: string }[]; drops: { id: string }[] };
    const list = async (query = "") =>
      (await (
        await listRoute.GET(new NextRequest(`http://localhost/api/storefront-orders${query}`))
      ).json()) as Body;

    as(a);
    const plain = await list();
    expect(plain.data).toEqual([]);
    expect(plain.drops).toEqual([]);

    const pinned = await list(`?drop=${drop.id}`);
    expect(pinned.data.map((o) => o.id)).toEqual([orderId]);
    expect(pinned.drops.map((d) => d.id)).toEqual([drop.id]);

    const forged = await list(`?drop=${foreign.id}`);
    expect(forged.data.map((o) => o.id)).not.toContain(foreignOrderId);
    expect(forged.drops).toEqual([]);
  });

  it("PATCH is tenant- and drop-scoped: other vendor, drop order and unknown ids are 404", async () => {
    const a = await seedVendor();
    const b = await seedVendor();
    const o = await menuOrder(a, "CASH");
    if (!o.ok) throw new Error("seed failed");
    const { drop, orderId: dropOrderId } = await seedDropOrder(a);

    as(b);
    const cross = await patchMenu(o.order.id, "confirm");
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual({ error: "Not found" });

    as(a);
    expect((await patchMenu(dropOrderId, "confirm")).status).toBe(404); // drop order via menu route
    expect((await patchMenu("nope", "confirm")).status).toBe(404);
    expect((await patchDrop(drop.id, o.order.id, "confirm")).status).toBe(404); // menu order via drop route
    expect((await patchMenu(o.order.id, "explode")).status).toBe(400);

    const still = await prisma.transaction.findFirstOrThrow({ where: { id: o.order.id } });
    expect(still.fulfilmentStatus).toBe("PLACED");
  });

  it("confirm → deliver on a cash order marks it paid and credits DailySummary once", async () => {
    const a = await seedVendor();
    const o = await menuOrder(a, "CASH");
    if (!o.ok) throw new Error("seed failed");
    as(a);

    const c = await patchMenu(o.order.id, "confirm");
    expect(c.status).toBe(200);
    expect(((await c.json()) as { data: { fulfilmentStatus: string } }).data.fulfilmentStatus).toBe("CONFIRMED");
    expect(await summary(a.id)).toBeNull(); // not paid yet → no revenue

    const d = await patchMenu(o.order.id, "deliver");
    expect(d.status).toBe(200);
    const delivered = ((await d.json()) as { data: { displayState: string; paymentStatus: string } }).data;
    expect(delivered.paymentStatus).toBe("PAID");
    expect(delivered.displayState).toBe("DELIVERED");

    // Repeats are rejected and never double-credit.
    expect((await patchMenu(o.order.id, "deliver")).status).toBe(409);
    expect((await patchMenu(o.order.id, "mark_paid")).status).toBe(409);
    const ds = await summary(a.id);
    expect(ds).toMatchObject({
      totalRevenuePaise: 5500,
      cashRevenuePaise: 5500,
      upiRevenuePaise: 0,
      totalTransactions: 1,
      totalItemsSold: 3,
    });
  });

  it("cancel on a paid UPI order reverses revenue and marks it REFUNDED", async () => {
    const a = await seedVendor();
    const o = await menuOrder(a, "UPI");
    if (!o.ok) throw new Error("seed failed");
    as(a);

    expect((await patchMenu(o.order.id, "mark_paid")).status).toBe(200);
    expect(await summary(a.id)).toMatchObject({ totalRevenuePaise: 5500, upiRevenuePaise: 5500, totalTransactions: 1 });

    const res = await patchMenu(o.order.id, "cancel");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { displayState: string; paymentStatus: string } };
    expect(body.data).toMatchObject({ displayState: "CANCELLED", paymentStatus: "REFUNDED" });
    expect(await summary(a.id)).toMatchObject({ totalRevenuePaise: 0, upiRevenuePaise: 0, totalTransactions: 0, totalItemsSold: 0 });
    expect((await patchMenu(o.order.id, "cancel")).status).toBe(409);
  });

  it("drop route behaviour is unchanged: frozen drop blocks confirm/cancel, allows mark_paid/deliver", async () => {
    const a = await seedVendor();
    const { drop, orderId } = await seedDropOrder(a);
    as(a);

    await prisma.drop.update({ where: { id: drop.id }, data: { status: "FROZEN" } });
    const frozen = await patchDrop(drop.id, orderId, "confirm");
    expect(frozen.status).toBe(409);
    expect(await frozen.json()).toEqual({ error: "drop_frozen" });
    expect((await patchDrop(drop.id, orderId, "cancel")).status).toBe(409);

    const del = await patchDrop(drop.id, orderId, "deliver");
    expect(del.status).toBe(200);
    expect(((await del.json()) as { data: { paymentStatus: string } }).data.paymentStatus).toBe("PAID");
    expect(await summary(a.id)).toMatchObject({ totalRevenuePaise: 1500, totalTransactions: 1 });

    // Another vendor can't touch it, and an unknown drop is a 404.
    const b = await seedVendor();
    as(b);
    expect((await patchDrop(drop.id, orderId, "undeliver")).status).toBe(404);
    as(a);
    expect((await patchDrop("no-such-drop", orderId, "undeliver")).status).toBe(404);
    expect((await patchDrop(drop.id, orderId, "undeliver")).status).toBe(200);
  });

  it("settings PATCH: turning menu orders on needs a published storefront and a payment method", async () => {
    const c = await seedVendor({ publishStorefront: false, acceptPayOnDelivery: false, acceptMenuOrders: false }, null);
    as(c);

    const notPublished = await patchVendor({ acceptMenuOrders: true });
    expect(notPublished.status).toBe(409);
    expect(await notPublished.json()).toEqual({ error: "storefront_not_published" });

    expect((await patchVendor({ publishStorefront: true })).status).toBe(200);
    const noPay = await patchVendor({ acceptMenuOrders: true });
    expect(noPay.status).toBe(409);
    expect(await noPay.json()).toEqual({ error: "no_payment_method" });

    // Same request can supply the missing payment method.
    expect((await patchVendor({ acceptMenuOrders: true, acceptPayOnDelivery: true })).status).toBe(200);

    expect((await patchVendor({ menuDeliveryFeePaise: 100_001 })).status).toBe(400);
    expect((await patchVendor({ menuDeliveryFeePaise: 25.5 })).status).toBe(400);
    const ok = await patchVendor({ menuFulfilmentMode: "BOTH", menuDeliveryFeePaise: 3000, menuPickupNote: " Gate 2 " });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { vendor: { settings: Record<string, unknown> } };
    expect(okBody.vendor.settings).not.toHaveProperty("razorpayKeySecretEnc");
    expect(okBody.vendor.settings).not.toHaveProperty("razorpayWebhookSecretEnc");

    const s = await prisma.vendorSettings.findUniqueOrThrow({ where: { vendorId: c.id } });
    expect(s).toMatchObject({
      acceptMenuOrders: true,
      publishStorefront: true,
      menuFulfilmentMode: "BOTH",
      menuDeliveryFeePaise: 3000,
      menuPickupNote: "Gate 2",
    });

    // Turning it off is always allowed; clearing the note stores null.
    expect((await patchVendor({ acceptMenuOrders: false, menuPickupNote: "" })).status).toBe(200);
    expect(await prisma.vendorSettings.findUniqueOrThrow({ where: { vendorId: c.id } })).toMatchObject({
      acceptMenuOrders: false,
      menuPickupNote: null,
    });
  });
});
