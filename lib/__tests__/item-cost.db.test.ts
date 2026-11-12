/**
 * Cost price DB integration test (lib/item-cost.ts rule 4: a bill line keeps
 * the cost of its moment) — runs only with DROPS_DB_TEST=1 against a THROWAWAY
 * Postgres (never production). Same setup as lib/__tests__/inventory.db.test.ts:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/item-cost.db.test.ts
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type MenuOrdersModule = typeof import("@/lib/menu-orders");
type CostServerModule = typeof import("@/lib/item-cost-server");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("cost price — DB integration", () => {
  let mo: MenuOrdersModule;
  let costServer: CostServerModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("item-cost.db.test refuses to run against a non-local DATABASE_URL");
    }
    mo = await import("@/lib/menu-orders");
    costServer = await import("@/lib/item-cost-server");
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

  /**
   * A clothing store: a kurti costing ₹250 in S (the item's cost), M (its own
   * ₹300) and a candle with no cost recorded.
   */
  async function seed() {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `cost-test-${tag}`,
        name: `Cost Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        stallType: "CLOTHING",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true, acceptPayOnDelivery: true } },
        menuItems: {
          create: [
            { name: "Cotton kurti", priceInPaise: 59900, costInPaise: 25000 },
            { name: "Rose Candle", priceInPaise: 29900 },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const kurti = vendor.menuItems.find((m) => m.name === "Cotton kurti")!;
    const candle = vendor.menuItems.find((m) => m.name === "Rose Candle")!;
    const mk = (label: string, sortOrder: number, extra: object = {}) =>
      prisma.itemVariant.create({ data: { vendorId: vendor.id, menuItemId: kurti.id, label, sortOrder, ...extra } });
    const s = await mk("S", 0);
    const m = await mk("M", 1, { costInPaise: 30000 });
    return { vendor: { id: vendor.id, plan: vendor.plan }, kurti, candle, s, m };
  }

  const settings = {
    acceptMenuOrders: true,
    acceptPayOnDelivery: true,
    menuFulfilmentMode: "BOTH" as const,
    menuDeliveryFeePaise: 0,
  };

  async function lineCosts(transactionId: string) {
    const lines = await prisma.orderItem.findMany({
      where: { transactionId },
      select: { name: true, costInPaise: true },
      orderBy: { name: "asc" },
    });
    return Object.fromEntries(lines.map((l) => [l.name, l.costInPaise]));
  }

  it("an online order keeps each line's cost: the size's own, else the item's, else none", async () => {
    const s = await seed();
    const placed = await mo.placeMenuOrder({
      vendor: s.vendor,
      settings,
      items: [
        { menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 },
        { menuItemId: s.kurti.id, variantId: s.m.id, qty: 2 },
        { menuItemId: s.candle.id, qty: 1 },
      ],
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
    if (!placed.ok) throw new Error(`order refused: ${placed.error.code}`);
    expect(await lineCosts(placed.order.id)).toEqual({
      "Cotton kurti – S": 25000,
      "Cotton kurti – M": 30000,
      "Rose Candle": null,
    });

    // A later change of cost leaves the old bill alone.
    await prisma.menuItem.update({ where: { id: s.kurti.id, vendorId: s.vendor.id }, data: { costInPaise: 99900 } });
    expect((await lineCosts(placed.order.id))["Cotton kurti – S"]).toBe(25000);
  });

  it("never reads another store's cost, and leaves typed-in lines alone", async () => {
    const a = await seed();
    const b = await seed();
    // A bill of store B with a line pointing at store A's kurti (can't happen through the routes) and a typed-in line.
    const bill = await prisma.transaction.create({
      data: {
        vendorId: b.vendor.id,
        billNumber: `AWZ-TEST-${randomBytes(4).toString("hex")}`,
        subtotalPaise: 69900,
        totalPaise: 69900,
        paymentMethod: "CASH",
        orderItems: {
          create: [
            { menuItemId: a.kurti.id, name: "Foreign kurti", priceInPaise: 59900, qty: 1, totalPaise: 59900 },
            { name: "Typed in", priceInPaise: 10000, qty: 1, totalPaise: 10000 },
          ],
        },
      },
    });
    await prisma.$transaction((tx) => costServer.stampOrderCosts(tx, b.vendor.id, bill.id));
    expect(await lineCosts(bill.id)).toEqual({ "Foreign kurti": null, "Typed in": null });
  });
});
