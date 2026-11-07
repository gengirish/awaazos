/**
 * "Order from menu" DB integration test — runs only with DROPS_DB_TEST=1
 * against a THROWAWAY Postgres (never production). Same setup as
 * lib/__tests__/drops.db.test.ts and included in `npm run test:drops:db`, or:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/menu-orders.db.test.ts
 */
import { randomBytes } from "node:crypto";

import type { Plan } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { upcomingMenuSlots } from "@/lib/menu-slots";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type MenuOrdersModule = typeof import("@/lib/menu-orders");
type DropsModule = typeof import("@/lib/drops");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("menu orders — DB integration", () => {
  let mo: MenuOrdersModule;
  let drops: DropsModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("menu-orders.db.test refuses to run against a non-local DATABASE_URL");
    }
    mo = await import("@/lib/menu-orders");
    drops = await import("@/lib/drops");
    ({ prisma } = await import("@/lib/prisma"));
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

  async function seed(plan: Plan = "PRO") {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `menu-test-${tag}`,
        name: `Menu Test ${tag}`,
        ownerName: "Test Owner",
        plan,
        settings: { create: { publishStorefront: true, acceptMenuOrders: true } },
        menuItems: {
          create: [
            { name: "Lays Bhel", priceInPaise: 7500 },
            { name: "Aam Ka Panna", priceInPaise: 5000 },
            { name: "Off today", priceInPaise: 3000, isAvailable: false },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const [bhel, panna, off] = ["Lays Bhel", "Aam Ka Panna", "Off today"].map(
      (n) => vendor.menuItems.find((m) => m.name === n)!,
    );
    return { vendor, bhel, panna, off };
  }

  const settings = {
    acceptMenuOrders: true,
    acceptPayOnDelivery: true,
    menuFulfilmentMode: "BOTH" as const,
    menuDeliveryFeePaise: 2000,
  };

  function base(v: { id: string; plan: Plan }) {
    return {
      vendor: { id: v.id, plan: v.plan },
      settings,
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
  }

  it("prices from MenuItem, merges duplicate lines, stores a drop-less storefront order", async () => {
    const { vendor, bhel, panna } = await seed();
    const res = await mo.placeMenuOrder({
      ...base(vendor),
      items: [
        { menuItemId: bhel.id, qty: 1 },
        { menuItemId: bhel.id, qty: 1 },
        { menuItemId: panna.id, qty: 3 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.subtotalPaise).toBe(2 * 7500 + 3 * 5000);
    expect(res.order.deliveryFeePaise).toBe(0);
    const t = await prisma.transaction.findFirstOrThrow({
      where: { id: res.order.id, vendorId: vendor.id },
      include: { orderItems: true },
    });
    expect(t.source).toBe("STOREFRONT");
    expect(t.dropId).toBeNull();
    expect(t.paymentStatus).toBe("PENDING");
    expect(t.orderItems).toHaveLength(2);
    expect(t.orderItems.every((i) => i.dropItemId === null)).toBe(true);
  });

  it("charges the delivery fee only for delivery and requires an address", async () => {
    const { vendor, bhel } = await seed();
    const noAddr = await mo.placeMenuOrder({
      ...base(vendor),
      fulfilmentType: "DELIVERY",
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(noAddr).toEqual({ ok: false, error: { code: "address_required" } });

    const ok = await mo.placeMenuOrder({
      ...base(vendor),
      fulfilmentType: "DELIVERY",
      deliveryAddress: "Flat 2, Banjara Hills",
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(ok.ok && ok.order.totalPaise).toBe(7500 + 2000);
  });

  it("rejects unavailable items, another vendor's items, and disabled settings", async () => {
    const a = await seed();
    const b = await seed();
    const off = await mo.placeMenuOrder({ ...base(a.vendor), items: [{ menuItemId: a.off.id, qty: 1 }] });
    expect(off).toEqual({ ok: false, error: { code: "item_not_found", menuItemId: a.off.id } });

    const foreign = await mo.placeMenuOrder({ ...base(a.vendor), items: [{ menuItemId: b.bhel.id, qty: 1 }] });
    expect(foreign).toEqual({ ok: false, error: { code: "item_not_found", menuItemId: b.bhel.id } });

    const disabled = await mo.placeMenuOrder({
      ...base(a.vendor),
      settings: { ...settings, acceptMenuOrders: false },
      items: [{ menuItemId: a.bhel.id, qty: 1 }],
    });
    expect(disabled).toEqual({ ok: false, error: { code: "menu_orders_disabled" } });

    const pickupOnly = await mo.placeMenuOrder({
      ...base(a.vendor),
      settings: { ...settings, menuFulfilmentMode: "PICKUP" },
      fulfilmentType: "DELIVERY",
      deliveryAddress: "x",
      items: [{ menuItemId: a.bhel.id, qty: 1 }],
    });
    expect(pickupOnly).toEqual({ ok: false, error: { code: "fulfilment_unavailable" } });

    const noCod = await mo.placeMenuOrder({
      ...base(a.vendor),
      settings: { ...settings, acceptPayOnDelivery: false },
      items: [{ menuItemId: a.bhel.id, qty: 1 }],
    });
    expect(noCod).toEqual({ ok: false, error: { code: "pay_on_delivery_disabled" } });
  });

  it("credits DailySummary on payment only, once, and unpaid orders don't hit the plan cap", async () => {
    const { vendor, bhel } = await seed();
    const res = await mo.placeMenuOrder({ ...base(vendor), items: [{ menuItemId: bhel.id, qty: 2 }] });
    if (!res.ok) throw new Error(res.error.code);

    expect(await drops.countBillableTxnThisMonth(prisma, vendor.id)).toBe(0);
    const before = await prisma.dailySummary.findMany({ where: { vendorId: vendor.id } });
    expect(before).toHaveLength(0);

    for (let i = 0; i < 2; i++) {
      await prisma.$transaction((tx) =>
        drops.markOrderPaid(tx, { vendorId: vendor.id, transactionId: res.order.id }),
      );
    }
    const after = await prisma.dailySummary.findMany({ where: { vendorId: vendor.id } });
    expect(after).toHaveLength(1);
    expect(after[0]!.totalRevenuePaise).toBe(15000);
    expect(after[0]!.cashRevenuePaise).toBe(15000);
    expect(after[0]!.totalTransactions).toBe(1);
    expect(await drops.countBillableTxnThisMonth(prisma, vendor.id)).toBe(1);
  });

  it("enforces the FREE monthly cap against billable (paid) orders", async () => {
    const { vendor, bhel } = await seed("FREE");
    // Fill the cap with paid counter sales (FREE = 50).
    await prisma.transaction.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        vendorId: vendor.id,
        billNumber: `CAP-${i}`,
        subtotalPaise: 100,
        totalPaise: 100,
        paymentMethod: "CASH" as const,
        paymentStatus: "PAID" as const,
        source: "MANUAL" as const,
      })),
    });
    const res = await mo.placeMenuOrder({ ...base(vendor), items: [{ menuItemId: bhel.id, qty: 1 }] });
    expect(res).toEqual({ ok: false, error: { code: "monthly_txn_cap_reached" } });
  });

  // Free trial and lock (lib/plan.ts): the vendor row is FREE; trialEndsAt decides.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const inDays = (n: number) => new Date(Date.now() + n * DAY_MS);

  it("a vendor on the free trial has no monthly cap", async () => {
    const { vendor, bhel } = await seed("FREE");
    await prisma.transaction.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        vendorId: vendor.id,
        billNumber: `TRIAL-${i}`,
        subtotalPaise: 100,
        totalPaise: 100,
        paymentMethod: "CASH" as const,
        paymentStatus: "PAID" as const,
        source: "MANUAL" as const,
      })),
    });
    const res = await mo.placeMenuOrder({
      ...base(vendor),
      vendor: { id: vendor.id, plan: vendor.plan, planExpiresAt: null, trialEndsAt: inDays(10) },
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(res.ok).toBe(true);
  });

  it("a locked vendor (trial over, not subscribed) takes no orders and stores nothing", async () => {
    const { vendor, bhel } = await seed("FREE");
    const res = await mo.placeMenuOrder({
      ...base(vendor),
      vendor: { id: vendor.id, plan: vendor.plan, planExpiresAt: null, trialEndsAt: inDays(-1) },
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(res).toEqual({ ok: false, error: { code: "orders_paused" } });
    expect(await prisma.transaction.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

  it("a paid plan takes orders after the trial has ended", async () => {
    const { vendor, bhel } = await seed("STARTER");
    const res = await mo.placeMenuOrder({
      ...base(vendor),
      vendor: { id: vendor.id, plan: "STARTER", planExpiresAt: inDays(20), trialEndsAt: inDays(-40) },
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(res.ok).toBe(true);
  });
  it("with slots set, needs a slot that is still offered and stores it on the order", async () => {
    const { vendor, bhel } = await seed();
    const rules = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "12:00", end: "14:00" }];
    const withSlots = { ...base(vendor), settings: { ...settings, menuSlots: rules } };
    const items = [{ menuItemId: bhel.id, qty: 1 }];

    expect(await mo.placeMenuOrder({ ...withSlots, items })).toEqual({ ok: false, error: { code: "slot_required" } });
    expect(await mo.placeMenuOrder({ ...withSlots, items, slotStart: "2020-01-01T06:30:00.000Z" })).toEqual({
      ok: false,
      error: { code: "slot_unavailable" },
    });

    const [slot] = upcomingMenuSlots(rules);
    const res = await mo.placeMenuOrder({ ...withSlots, items, slotStart: slot.key });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await prisma.transaction.findFirstOrThrow({ where: { id: res.order.id, vendorId: vendor.id } });
    expect(t.fulfilAt).toEqual(slot.start);
    expect(t.fulfilUntil).toEqual(slot.end);
  });

  it("stores a delivery address in parts beside the whole address", async () => {
    const { vendor, bhel } = await seed();
    const res = await mo.placeMenuOrder({
      ...base(vendor),
      fulfilmentType: "DELIVERY",
      deliveryAddress: "Flat 302, Lake View",
      deliveryLocality: "Kondapur",
      deliveryLandmark: "Ganesh temple",
      deliveryPincode: "500 084",
      items: [{ menuItemId: bhel.id, qty: 1 }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await prisma.transaction.findFirstOrThrow({ where: { id: res.order.id, vendorId: vendor.id } });
    expect(t.deliveryAddress).toBe("Flat 302, Lake View, Near Ganesh temple, Kondapur 500084");
    expect(t.deliveryLocality).toBe("Kondapur");
    expect(t.deliveryLandmark).toBe("Ganesh temple");
    expect(t.deliveryPincode).toBe("500084");
    // No slots set: no "when" on the order.
    expect(t.fulfilAt).toBeNull();
  });
  it("with delivery areas, charges the area's fee and refuses other localities; pickup is untouched", async () => {
    const { vendor, bhel } = await seed();
    const areas = [
      { name: "Kondapur", feePaise: 0 },
      { name: "Madhapur", feePaise: null },
    ];
    const withAreas = { ...base(vendor), settings: { ...settings, deliveryAreas: areas } };
    const items = [{ menuItemId: bhel.id, qty: 1 }];
    const deliver = { fulfilmentType: "DELIVERY" as const, deliveryAddress: "Flat 2" };

    expect(await mo.placeMenuOrder({ ...withAreas, ...deliver, deliveryLocality: "Miyapur", items })).toEqual({
      ok: false,
      error: { code: "outside_delivery_area" },
    });
    expect(await mo.placeMenuOrder({ ...withAreas, ...deliver, items })).toEqual({
      ok: false,
      error: { code: "outside_delivery_area" },
    });

    const free = await mo.placeMenuOrder({ ...withAreas, ...deliver, deliveryLocality: " kondapur", items });
    expect(free.ok && free.order.deliveryFeePaise).toBe(0);
    const usual = await mo.placeMenuOrder({ ...withAreas, ...deliver, deliveryLocality: "Madhapur", items });
    expect(usual.ok && usual.order.deliveryFeePaise).toBe(2000);
    const pickup = await mo.placeMenuOrder({ ...withAreas, items });
    expect(pickup.ok).toBe(true);
  });
});
