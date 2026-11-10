/**
 * Inventory DB integration test (lib/inventory.ts rules) — runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production). Same setup
 * as lib/__tests__/drops.db.test.ts:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/inventory.db.test.ts
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type MenuOrdersModule = typeof import("@/lib/menu-orders");
type DropsModule = typeof import("@/lib/drops");
type InventoryServerModule = typeof import("@/lib/inventory-server");
type ActionsModule = typeof import("@/lib/storefront-order-actions");
type MenuStockModule = typeof import("@/lib/menu-stock");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("inventory — DB integration", () => {
  let mo: MenuOrdersModule;
  let drops: DropsModule;
  let inv: InventoryServerModule;
  let actions: ActionsModule;
  let menuStock: MenuStockModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];
  const MIN = 60_000;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("inventory.db.test refuses to run against a non-local DATABASE_URL");
    }
    mo = await import("@/lib/menu-orders");
    drops = await import("@/lib/drops");
    inv = await import("@/lib/inventory-server");
    actions = await import("@/lib/storefront-order-actions");
    menuStock = await import("@/lib/menu-stock");
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

  /** A store with one tracked product (counted an hour ago) and one untracked. */
  async function seed(stockQty = 3) {
    const tag = randomBytes(5).toString("hex");
    const countedAt = new Date(Date.now() - 60 * MIN);
    const vendor = await prisma.vendor.create({
      data: {
        slug: `inv-test-${tag}`,
        name: `Inventory Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true, acceptPayOnDelivery: true } },
        menuItems: {
          create: [
            { name: "Evil Eye Bracelet", priceInPaise: 49900, stockQty, stockCountedAt: countedAt },
            { name: "Rose Candle", priceInPaise: 29900 },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const tracked = vendor.menuItems.find((m) => m.name === "Evil Eye Bracelet")!;
    const untracked = vendor.menuItems.find((m) => m.name === "Rose Candle")!;
    return { vendor: { id: vendor.id, plan: vendor.plan }, tracked, untracked };
  }

  const settings = {
    acceptMenuOrders: true,
    acceptPayOnDelivery: true,
    menuFulfilmentMode: "BOTH" as const,
    menuDeliveryFeePaise: 0,
  };

  function menuOrder(
    s: Awaited<ReturnType<typeof seed>>,
    items: { menuItemId: string; qty: number }[],
    paymentMethod: "UPI" | "CASH" = "CASH",
  ) {
    return mo.placeMenuOrder({
      vendor: s.vendor,
      settings,
      items,
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod,
    });
  }

  async function leftOf(s: Awaited<ReturnType<typeof seed>>) {
    const item = await prisma.menuItem.findFirstOrThrow({
      where: { id: s.tracked.id, vendorId: s.vendor.id },
      select: { id: true, stockQty: true, stockCountedAt: true },
    });
    return (await inv.stockLeftByMenuItem(prisma, s.vendor.id, [item])).get(item.id);
  }

  async function setAsideOf(s: Awaited<ReturnType<typeof seed>>) {
    const item = await prisma.menuItem.findFirstOrThrow({
      where: { id: s.tracked.id, vendorId: s.vendor.id },
      select: { id: true, stockQty: true, stockCountedAt: true },
    });
    return (await inv.stockSetAsideByMenuItem(prisma, s.vendor.id, [item])).get(item.id);
  }

  /** The /menu −1 / +1 path (POST /api/menu/[id]/stock { adjust }): delta on the count, time kept. */
  async function adjust(s: Awaited<ReturnType<typeof seed>>, delta: number) {
    const left = (await leftOf(s)) ?? 0;
    const d = menuStock.adjustDelta(left, delta);
    if (d !== 0) await inv.recordStockAdjust(prisma, s.vendor.id, s.tracked.id, d);
  }

  /** The board's "Delivered" tap on a menu order. */
  function deliver(s: Awaited<ReturnType<typeof seed>>, orderId: string, now?: Date) {
    return prisma.$transaction((tx) =>
      actions.applyStorefrontOrderAction(tx, {
        scope: { id: orderId, vendorId: s.vendor.id, source: "STOREFRONT", dropId: null },
        action: "deliver",
        dropStatus: null,
        now,
      }),
    );
  }

  /** A counter sale (source ≠ STOREFRONT) of the tracked product. */
  async function counterSale(s: Awaited<ReturnType<typeof seed>>, qty: number) {
    await prisma.transaction.create({
      data: {
        vendorId: s.vendor.id,
        billNumber: `AWZ-TEST-${randomBytes(4).toString("hex")}`,
        subtotalPaise: s.tracked.priceInPaise * qty,
        totalPaise: s.tracked.priceInPaise * qty,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        source: "MANUAL",
        orderItems: {
          create: [
            {
              menuItemId: s.tracked.id,
              name: s.tracked.name,
              priceInPaise: s.tracked.priceInPaise,
              qty,
              totalPaise: s.tracked.priceInPaise * qty,
            },
          ],
        },
      },
    });
  }

  it("a menu order can't take more than is left; untracked items are never limited", async () => {
    const s = await seed(3);
    expect(await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 4 }])).toEqual({
      ok: false,
      error: { code: "out_of_stock", menuItemId: s.tracked.id, remaining: 3 },
    });
    expect((await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }])).ok).toBe(true);
    expect(await leftOf(s)).toBe(1);
    // Duplicate lines are merged before the check.
    expect(
      await menuOrder(s, [
        { menuItemId: s.tracked.id, qty: 1 },
        { menuItemId: s.tracked.id, qty: 1 },
      ]),
    ).toEqual({ ok: false, error: { code: "out_of_stock", menuItemId: s.tracked.id, remaining: 1 } });
    expect((await menuOrder(s, [{ menuItemId: s.untracked.id, qty: 500 }])).ok).toBe(true);
  });

  it("concurrent menu orders for the last units never oversell", async () => {
    const s = await seed(3);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => menuOrder(s, [{ menuItemId: s.tracked.id, qty: 1 }])),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.error.code === "out_of_stock")).toHaveLength(5);
    expect(await leftOf(s)).toBe(0);
  });

  it("a counter sale counts toward stock and may oversell; online then refuses", async () => {
    const s = await seed(3);
    await counterSale(s, 2);
    expect(await leftOf(s)).toBe(1);
    await counterSale(s, 3); // the counter never refuses (rule 5)
    expect(await leftOf(s)).toBe(-2);
    expect(await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "out_of_stock", menuItemId: s.tracked.id, remaining: 0 },
    });
  });

  it("an unpaid UPI order's lapsed hold gives its stock back; a cancel does too", async () => {
    const s = await seed(2);
    const upi = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }], "UPI");
    expect(upi.ok).toBe(true);
    if (!upi.ok) return;
    expect(await leftOf(s)).toBe(0);
    // Placed 20 minutes ago, still after the count: past PENDING_HOLD_MINUTES.
    await prisma.transaction.updateMany({
      where: { id: upi.order.id, vendorId: s.vendor.id },
      data: { createdAt: new Date(Date.now() - 20 * MIN) },
    });
    expect(await leftOf(s)).toBe(2);

    const cash = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }]);
    expect(cash.ok).toBe(true);
    if (!cash.ok) return;
    expect(await leftOf(s)).toBe(0);
    await prisma.$transaction((tx) => drops.cancelOrder(tx, { vendorId: s.vendor.id, transactionId: cash.order.id }));
    expect(await leftOf(s)).toBe(2);
  });

  it("a new count resets stock: only sales after it count", async () => {
    const s = await seed(3);
    await counterSale(s, 3);
    expect(await leftOf(s)).toBe(0);
    // A count of 5 one second from now — sales before it are already off the shelf.
    const res = await inv.recordStockCount(prisma, s.vendor.id, s.tracked.id, 5, new Date(Date.now() + 1000));
    expect(res.count).toBe(1);
    expect(await leftOf(s)).toBe(5);
    // Another vendor can't record a count on this item (compound scope).
    const other = await seed(1);
    expect((await inv.recordStockCount(prisma, other.vendor.id, s.tracked.id, 99)).count).toBe(0);
    // Stop tracking: null clears the count, and the item is no longer limited.
    await inv.recordStockCount(prisma, s.vendor.id, s.tracked.id, null);
    expect(await leftOf(s)).toBeUndefined();
    expect((await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 50 }])).ok).toBe(true);
  });

  it("a drop item is capped by its product's stock too, shared with menu orders", async () => {
    const s = await seed(3);
    const now = new Date();
    const drop = await prisma.drop.create({
      data: {
        vendorId: s.vendor.id,
        title: "Weekend",
        date: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now.getTime() + 48 * 60 * MIN),
        fulfilmentEndsAt: new Date(now.getTime() + 51 * 60 * MIN),
        closesAt: new Date(now.getTime() + 24 * 60 * MIN),
        status: "OPEN",
        showEverydayMenu: true, // menu orders stay open beside the drop
        items: {
          create: [
            { menuItemId: s.tracked.id, priceInPaise: s.tracked.priceInPaise, maxQty: 10, sortOrder: 0 },
            { menuItemId: s.untracked.id, priceInPaise: s.untracked.priceInPaise, maxQty: 2, sortOrder: 1 },
          ],
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const [trackedItem, untrackedItem] = drop.items;
    const dropOrder = (dropItemId: string, qty: number) =>
      drops.placeStorefrontOrder({
        vendor: s.vendor,
        acceptPayOnDelivery: true,
        dropId: drop.id,
        items: [{ dropItemId, qty }],
        customerName: "Meera",
        customerPhone: "+919876543210",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
      });

    let remaining = await drops.remainingByDropItem(prisma, s.vendor.id, drop);
    expect(remaining.get(trackedItem.id)).toBe(3); // stock 3 beats maxQty 10
    expect(remaining.get(untrackedItem.id)).toBe(2); // only the drop cap

    // A menu order takes the same stock.
    expect((await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 1 }])).ok).toBe(true);
    expect(await dropOrder(trackedItem.id, 3)).toEqual({
      ok: false,
      error: { code: "sold_out", dropItemId: trackedItem.id, remaining: 2 },
    });
    expect((await dropOrder(trackedItem.id, 2)).ok).toBe(true);
    remaining = await drops.remainingByDropItem(prisma, s.vendor.id, drop);
    expect(remaining.get(trackedItem.id)).toBe(0);
    // And the drop's orders count against the everyday menu.
    expect(await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 1 }])).toEqual({
      ok: false,
      error: { code: "out_of_stock", menuItemId: s.tracked.id, remaining: 0 },
    });
  });

  it("a free gift that wouldn't fit in stock is dropped, the order still goes through", async () => {
    const s = await seed(1);
    await prisma.offer.create({
      data: {
        vendorId: s.vendor.id,
        name: "Free bracelet",
        eligibility: "ALL",
        minQty: 2,
        discountType: "FREE_ITEM",
        percentBps: 0,
        freeItemId: s.tracked.id,
        onPos: false,
      },
    });
    // 2 candles + 1 bracelet: the bracelet is the last one, so no gift on top.
    const res = await menuOrder(s, [
      { menuItemId: s.untracked.id, qty: 2 },
      { menuItemId: s.tracked.id, qty: 1 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = await prisma.orderItem.findMany({ where: { transactionId: res.order.id } });
    expect(lines.some((l) => l.isGift)).toBe(false);
    expect(await leftOf(s)).toBe(0);

    // Handed over, then a recount: with stock for it, the gift is added and leaves the shelf.
    await deliver(s, res.order.id);
    await inv.recordStockCount(prisma, s.vendor.id, s.tracked.id, 2, new Date(Date.now() + 1000));
    await new Promise((r) => setTimeout(r, 1100));
    const withGift = await menuOrder(s, [{ menuItemId: s.untracked.id, qty: 2 }]);
    expect(withGift.ok).toBe(true);
    if (!withGift.ok) return;
    const giftLines = await prisma.orderItem.findMany({ where: { transactionId: withGift.order.id, isGift: true } });
    expect(giftLines).toHaveLength(1);
    expect(await leftOf(s)).toBe(1);
  });

  it("an adjust keeps open orders counting: a lapsed hold or a cancel after it still gives stock back", async () => {
    const s = await seed(5);
    const upi = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }], "UPI");
    expect(upi.ok).toBe(true);
    if (!upi.ok) return;
    expect(await leftOf(s)).toBe(3);
    await adjust(s, 1); // "+1 received" while the UPI order is still held
    expect(await leftOf(s)).toBe(4);
    // The hold lapses: its 2 come back on top of the +1.
    await prisma.transaction.updateMany({
      where: { id: upi.order.id, vendorId: s.vendor.id },
      data: { createdAt: new Date(Date.now() - 20 * MIN) },
    });
    expect(await leftOf(s)).toBe(6);

    const cash = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }]);
    expect(cash.ok).toBe(true);
    if (!cash.ok) return;
    await adjust(s, -1); // "−1 damaged"
    expect(await leftOf(s)).toBe(3);
    await prisma.$transaction((tx) => drops.cancelOrder(tx, { vendorId: s.vendor.id, transactionId: cash.order.id }));
    expect(await leftOf(s)).toBe(5);
  });

  it("an adjust never takes stock below 0 and never lifts an oversold item on a decrease", async () => {
    const s = await seed(1);
    await adjust(s, -3);
    expect(await leftOf(s)).toBe(0);
    await counterSale(s, 2);
    expect(await leftOf(s)).toBe(-2);
    await adjust(s, -1);
    expect(await leftOf(s)).toBe(-2);
    await adjust(s, 1);
    expect(await leftOf(s)).toBe(-1);
    // Another vendor's adjust changes nothing (compound scope).
    const other = await seed(1);
    expect((await inv.recordStockAdjust(prisma, other.vendor.id, s.tracked.id, 50)).count).toBe(0);
  });

  it("a count includes pieces packed for orders not handed over yet", async () => {
    const s = await seed(5);
    const waiting = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }]); // pay on delivery, still here
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    const gone = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 1 }]);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    await deliver(s, gone.order.id); // handed over before the count: not on the shelf
    expect(await leftOf(s)).toBe(2);
    expect(await setAsideOf(s)).toBe(2);

    // The seller counts the shelf: 4, the 2 packed pieces included.
    await inv.recordStockCount(prisma, s.vendor.id, s.tracked.id, 4, new Date(Date.now() + 1000));
    expect(await leftOf(s)).toBe(2);
    // Counting the same shelf again (what "Set count" pre-fills) changes nothing.
    expect(menuStock.onShelfCount({ stockLeft: 2, stockSetAside: 2 })).toBe(4);

    // Handed over after the count: they left a shelf the count included, so left stays.
    await deliver(s, waiting.order.id, new Date(Date.now() + 2000));
    expect(await leftOf(s)).toBe(2);
    expect(await setAsideOf(s)).toBe(0);
  });

  it("a packed order cancelled after the count frees its pieces", async () => {
    const s = await seed(5);
    const waiting = await menuOrder(s, [{ menuItemId: s.tracked.id, qty: 2 }]);
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    await inv.recordStockCount(prisma, s.vendor.id, s.tracked.id, 5, new Date(Date.now() + 1000));
    expect(await leftOf(s)).toBe(3);
    await prisma.$transaction((tx) =>
      drops.cancelOrder(tx, { vendorId: s.vendor.id, transactionId: waiting.order.id }),
    );
    expect(await leftOf(s)).toBe(5);
  });
});
