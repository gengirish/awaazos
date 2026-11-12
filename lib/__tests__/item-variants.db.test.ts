/**
 * Sizes / colours DB integration test (lib/item-variants.ts rules) — runs only
 * with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production). Same
 * setup as lib/__tests__/inventory.db.test.ts:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/item-variants.db.test.ts
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type MenuOrdersModule = typeof import("@/lib/menu-orders");
type DropsModule = typeof import("@/lib/drops");
type InventoryServerModule = typeof import("@/lib/inventory-server");
type ActionsModule = typeof import("@/lib/storefront-order-actions");
type MenuStockServerModule = typeof import("@/lib/menu-stock-server");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("item variants — DB integration", () => {
  let mo: MenuOrdersModule;
  let drops: DropsModule;
  let inv: InventoryServerModule;
  let actions: ActionsModule;
  let menuStockServer: MenuStockServerModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];
  const MIN = 60_000;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("item-variants.db.test refuses to run against a non-local DATABASE_URL");
    }
    mo = await import("@/lib/menu-orders");
    drops = await import("@/lib/drops");
    inv = await import("@/lib/inventory-server");
    actions = await import("@/lib/storefront-order-actions");
    menuStockServer = await import("@/lib/menu-stock-server");
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
   * A clothing store: a kurti in S (2 counted an hour ago, item price), M
   * (₹649, not counted) and L (switched off), plus a candle with no sizes.
   */
  async function seed() {
    const tag = randomBytes(5).toString("hex");
    const countedAt = new Date(Date.now() - 60 * MIN);
    const vendor = await prisma.vendor.create({
      data: {
        slug: `var-test-${tag}`,
        name: `Variants Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        stallType: "CLOTHING",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true, acceptPayOnDelivery: true } },
        menuItems: {
          create: [
            { name: "Cotton kurti", priceInPaise: 59900 },
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
    const s = await mk("S", 0, { stockQty: 2, stockCountedAt: countedAt });
    const m = await mk("M", 1, { priceInPaise: 64900 });
    const l = await mk("L", 2, { isAvailable: false });
    return { vendor: { id: vendor.id, plan: vendor.plan }, kurti, candle, s, m, l };
  }

  const settings = {
    acceptMenuOrders: true,
    acceptPayOnDelivery: true,
    menuFulfilmentMode: "BOTH" as const,
    menuDeliveryFeePaise: 0,
  };

  function menuOrder(
    s: Awaited<ReturnType<typeof seed>>,
    items: { menuItemId: string; variantId?: string | null; qty: number }[],
  ) {
    return mo.placeMenuOrder({
      vendor: s.vendor,
      settings,
      items,
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
  }

  async function variantLeft(s: Awaited<ReturnType<typeof seed>>, variantId: string) {
    const v = await prisma.itemVariant.findFirstOrThrow({
      where: { id: variantId, vendorId: s.vendor.id },
      select: { id: true, stockQty: true, stockCountedAt: true },
    });
    return (await inv.stockLeftByVariant(prisma, s.vendor.id, [v])).get(v.id);
  }

  function act(s: Awaited<ReturnType<typeof seed>>, orderId: string, action: "cancel" | "deliver") {
    return prisma.$transaction((tx) =>
      actions.applyStorefrontOrderAction(tx, {
        scope: { id: orderId, vendorId: s.vendor.id, source: "STOREFRONT", dropId: null },
        action,
        dropStatus: null,
      }),
    );
  }

  it("an item with sizes is ordered by size, priced and named from it", async () => {
    const s = await seed();
    expect(await menuOrder(s, [{ menuItemId: s.kurti.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "size_required", menuItemId: s.kurti.id },
    });
    // Switched off, another item's size, or a size on an item without sizes: not offered.
    expect(await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.l.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "item_not_found", menuItemId: s.kurti.id, variantId: s.l.id },
    });
    expect(await menuOrder(s, [{ menuItemId: s.candle.id, variantId: s.m.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "item_not_found", menuItemId: s.candle.id, variantId: s.m.id },
    });

    const res = await menuOrder(s, [
      { menuItemId: s.kurti.id, variantId: s.m.id, qty: 1 },
      { menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 },
      // Repeated lines for one size merge; the candle has no sizes.
      { menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 },
      { menuItemId: s.candle.id, qty: 1 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.subtotalPaise).toBe(64900 + 2 * 59900 + 29900);
    const lines = await prisma.orderItem.findMany({
      where: { transactionId: res.order.id },
      select: { name: true, variantId: true, priceInPaise: true, qty: true, totalPaise: true },
      orderBy: { name: "asc" },
    });
    expect(lines).toEqual([
      { name: "Cotton kurti – M", variantId: s.m.id, priceInPaise: 64900, qty: 1, totalPaise: 64900 },
      { name: "Cotton kurti – S", variantId: s.s.id, priceInPaise: 59900, qty: 2, totalPaise: 119800 },
      { name: "Rose Candle", variantId: null, priceInPaise: 29900, qty: 1, totalPaise: 29900 },
    ]);
  });

  it("stock is per size: a shortfall names the size, a cancel gives it back, an uncounted size never limits", async () => {
    const s = await seed();
    expect(await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.s.id, qty: 3 }])).toEqual({
      ok: false,
      error: { code: "out_of_stock", menuItemId: s.kurti.id, variantId: s.s.id, remaining: 2 },
    });
    const two = await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.s.id, qty: 2 }]);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(await variantLeft(s, s.s.id)).toBe(0);
    expect(await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 }])).toMatchObject({
      ok: false,
      error: { code: "out_of_stock", variantId: s.s.id, remaining: 0 },
    });
    // M isn't counted: any quantity goes through, and S isn't touched by it.
    expect((await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.m.id, qty: 9 }])).ok).toBe(true);
    expect(await variantLeft(s, s.s.id)).toBe(0);

    await act(s, two.order.id, "cancel");
    expect(await variantLeft(s, s.s.id)).toBe(2);
  });

  it("a size's count includes packed orders until handed over, and an adjust keeps the count time", async () => {
    const s = await seed();
    const res = await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = async () =>
      prisma.itemVariant.findFirstOrThrow({
        where: { id: s.s.id, vendorId: s.vendor.id },
        select: { id: true, stockQty: true, stockCountedAt: true },
      });
    expect((await inv.stockSetAsideByVariant(prisma, s.vendor.id, [await row()])).get(s.s.id)).toBe(1);

    // +3 received: the count moves, its time doesn't, so the open order still counts.
    const before = (await row()).stockCountedAt;
    await inv.recordVariantStockAdjust(prisma, s.vendor.id, s.kurti.id, s.s.id, 3);
    expect((await row()).stockCountedAt).toEqual(before);
    expect(await variantLeft(s, s.s.id)).toBe(4);

    // A recount of the shelf (packed piece included) keeps the order counted (lib/inventory.ts rule 2b).
    await inv.recordVariantStockCount(prisma, s.vendor.id, s.kurti.id, s.s.id, 5, new Date(Date.now() + 1000));
    await new Promise((r) => setTimeout(r, 1100));
    expect(await variantLeft(s, s.s.id)).toBe(4);
    await act(s, res.order.id, "deliver");
    expect(await variantLeft(s, s.s.id)).toBe(4);
    expect((await inv.stockSetAsideByVariant(prisma, s.vendor.id, [await row()])).get(s.s.id)).toBe(0);

    // Compound scope: another item's id changes nothing.
    const wrong = await inv.recordVariantStockAdjust(prisma, s.vendor.id, s.candle.id, s.s.id, 10);
    expect(wrong.count).toBe(0);
  });

  it("withVariants lists sizes in order with their own stock; the item keeps none", async () => {
    const s = await seed();
    await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.s.id, qty: 1 }]);
    const [kurti, candle] = await menuStockServer.withVariants(prisma, s.vendor.id, [{ id: s.kurti.id }, { id: s.candle.id }]);
    expect(candle.variants).toEqual([]);
    expect(kurti.variants.map((v) => [v.label, v.priceInPaise, v.isAvailable, v.stockLeft, v.stockSetAside])).toEqual([
      ["S", null, true, 1, 1],
      ["M", 64900, true, null, null],
      ["L", null, false, null, null],
    ]);
  });

  it("a free gift with sizes is skipped: the buyer would have to pick one", async () => {
    const s = await seed();
    await prisma.offer.create({
      data: {
        vendorId: s.vendor.id,
        name: "Free kurti",
        eligibility: "ALL",
        minQty: 1,
        discountType: "FREE_ITEM",
        percentBps: 0,
        freeItemId: s.kurti.id,
        onPos: false,
      },
    });
    const res = await menuOrder(s, [{ menuItemId: s.candle.id, qty: 1 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = await prisma.orderItem.findMany({ where: { transactionId: res.order.id } });
    expect(lines.map((l) => l.isGift)).toEqual([false]);
  });

  it("deleting a size keeps old bills: the line keeps its name, its variantId goes", async () => {
    const s = await seed();
    const res = await menuOrder(s, [{ menuItemId: s.kurti.id, variantId: s.m.id, qty: 1 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await prisma.itemVariant.deleteMany({ where: { id: s.m.id, vendorId: s.vendor.id } });
    const [line] = await prisma.orderItem.findMany({ where: { transactionId: res.order.id } });
    expect(line).toMatchObject({ name: "Cotton kurti – M", variantId: null, priceInPaise: 64900 });
  });
  it("drop orders by size: size required, priced from the size else the drop, one cap for all sizes, each size's own stock", async () => {
    const s = await seed();
    const now = new Date();
    const drop = await prisma.drop.create({
      data: {
        vendorId: s.vendor.id,
        title: "Festive drop",
        date: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now.getTime() + 48 * 60 * MIN),
        fulfilmentEndsAt: new Date(now.getTime() + 51 * 60 * MIN),
        closesAt: new Date(now.getTime() + 24 * 60 * MIN),
        status: "OPEN",
        // Today's drop price ₹549; the cap of 4 covers every size together.
        items: { create: [{ menuItemId: s.kurti.id, priceInPaise: 54900, maxQty: 4, perOrderLimit: 3, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    const [kurtiItem] = drop.items;
    const dropOrder = (items: { variantId?: string | null; qty: number }[]) =>
      drops.placeStorefrontOrder({
        vendor: s.vendor,
        acceptPayOnDelivery: true,
        dropId: drop.id,
        items: items.map((i) => ({ dropItemId: kurtiItem!.id, ...i })),
        customerName: "Meera",
        customerPhone: "+919876543210",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
      });

    expect(await dropOrder([{ qty: 1 }])).toEqual({
      ok: false,
      error: { code: "size_required", dropItemId: kurtiItem!.id },
    });
    // L is switched off.
    expect(await dropOrder([{ variantId: s.l.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "item_not_found", dropItemId: kurtiItem!.id, variantId: s.l.id },
    });
    // S has 2 of its own.
    expect(await dropOrder([{ variantId: s.s.id, qty: 3 }])).toEqual({
      ok: false,
      error: { code: "sold_out", dropItemId: kurtiItem!.id, variantId: s.s.id, remaining: 2 },
    });
    // The per-order limit counts both sizes: 2 + 2 > 3.
    expect(await dropOrder([{ variantId: s.s.id, qty: 2 }, { variantId: s.m.id, qty: 2 }])).toEqual({
      ok: false,
      error: { code: "per_order_limit", dropItemId: kurtiItem!.id, limit: 3 },
    });

    const placed = await dropOrder([{ variantId: s.s.id, qty: 1 }, { variantId: s.m.id, qty: 2 }]);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // S at the drop's price (no price of its own), M at its own ₹649.
    expect(placed.order.subtotalPaise).toBe(54900 + 2 * 64900);
    const lines = await prisma.orderItem.findMany({
      where: { transactionId: placed.order.id },
      orderBy: { name: "asc" },
      select: { name: true, variantId: true, dropItemId: true, priceInPaise: true, qty: true },
    });
    expect(lines).toEqual([
      { name: "Cotton kurti – M", variantId: s.m.id, dropItemId: kurtiItem!.id, priceInPaise: 64900, qty: 2 },
      { name: "Cotton kurti – S", variantId: s.s.id, dropItemId: kurtiItem!.id, priceInPaise: 54900, qty: 1 },
    ]);
    expect(await variantLeft(s, s.s.id)).toBe(1);

    // 3 of the drop's 4 are taken, whatever the size: M has no count of its own, the cap still binds.
    expect(await dropOrder([{ variantId: s.m.id, qty: 2 }])).toEqual({
      ok: false,
      error: { code: "sold_out", dropItemId: kurtiItem!.id, remaining: 1 },
    });
    expect((await dropOrder([{ variantId: s.m.id, qty: 1 }])).ok).toBe(true);
  });

  it("a drop's free gift with sizes is skipped; the order still goes through", async () => {
    const s = await seed();
    const now = new Date();
    await prisma.offer.create({
      data: {
        vendorId: s.vendor.id,
        name: "Free kurti",
        eligibility: "ALL",
        minQty: 1,
        discountType: "FREE_ITEM",
        percentBps: 0,
        freeItemId: s.kurti.id,
        onPos: false,
      },
    });
    const drop = await prisma.drop.create({
      data: {
        vendorId: s.vendor.id,
        title: "Gift drop",
        date: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now.getTime() + 48 * 60 * MIN),
        fulfilmentEndsAt: new Date(now.getTime() + 51 * 60 * MIN),
        closesAt: new Date(now.getTime() + 24 * 60 * MIN),
        status: "OPEN",
        items: {
          create: [
            { menuItemId: s.candle.id, priceInPaise: 29900, sortOrder: 0 },
            { menuItemId: s.kurti.id, priceInPaise: 59900, sortOrder: 1 },
          ],
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const res = await drops.placeStorefrontOrder({
      vendor: s.vendor,
      acceptPayOnDelivery: true,
      dropId: drop.id,
      items: [{ dropItemId: drop.items[0]!.id, qty: 1 }],
      customerName: "Meera",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = await prisma.orderItem.findMany({ where: { transactionId: res.order.id } });
    expect(lines.map((l) => l.isGift)).toEqual([false]);
  });
});
