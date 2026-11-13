/**
 * Stock purchases DB integration test (rules in lib/stock-purchase.ts) — runs
 * only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production).
 * Same setup as lib/__tests__/inventory.db.test.ts:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/stock-purchase.db.test.ts
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type PurchaseServerModule = typeof import("@/lib/stock-purchase-server");
type InventoryServerModule = typeof import("@/lib/inventory-server");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("stock purchases — DB integration", () => {
  let ps: PurchaseServerModule;
  let inv: InventoryServerModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("stock-purchase.db.test refuses to run against a non-local DATABASE_URL");
    }
    ps = await import("@/lib/stock-purchase-server");
    inv = await import("@/lib/inventory-server");
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

  const countedAt = new Date("2026-11-01T06:00:00.000Z");

  /**
   * A clothing store: a candle counted at 5 (cost ₹100), a kurti in M (tracked,
   * the item's cost ₹250), L (tracked, its own ₹300) and XL (not tracked), and
   * a scarf whose stock is not tracked.
   */
  async function seed() {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `purchase-test-${tag}`,
        name: `Purchase Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        stallType: "CLOTHING",
        menuItems: {
          create: [
            { name: "Rose Candle", priceInPaise: 29900, costInPaise: 10000, stockQty: 5, stockCountedAt: countedAt },
            { name: "Cotton kurti", priceInPaise: 59900, costInPaise: 25000 },
            { name: "Scarf", priceInPaise: 19900 },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const byName = (name: string) => vendor.menuItems.find((m) => m.name === name)!;
    const kurti = byName("Cotton kurti");
    const mk = (label: string, sortOrder: number, extra: object = {}) =>
      prisma.itemVariant.create({ data: { vendorId: vendor.id, menuItemId: kurti.id, label, sortOrder, ...extra } });
    const m = await mk("M", 0, { stockQty: 2, stockCountedAt: countedAt });
    const l = await mk("L", 1, { stockQty: 1, stockCountedAt: countedAt, costInPaise: 30000 });
    const xl = await mk("XL", 2);
    return { vendorId: vendor.id, candle: byName("Rose Candle"), kurti, scarf: byName("Scarf"), m, l, xl };
  }

  const receive = (input: Parameters<PurchaseServerModule["receiveStock"]>[1]) =>
    prisma.$transaction((tx) => ps.receiveStock(tx, input));

  async function refused(input: Parameters<PurchaseServerModule["receiveStock"]>[1]) {
    try {
      await receive(input);
    } catch (err) {
      if (err instanceof ps.ReceiveStockError) return { status: err.status, code: err.code };
      throw err;
    }
    throw new Error("expected receiveStock to refuse");
  }

  it("adds to the count without moving its time, records the purchase and sets the latest cost", async () => {
    const s = await seed();
    const at = new Date("2026-11-12T08:00:00.000Z");
    const out = await receive({
      vendorId: s.vendorId,
      menuItemId: s.candle.id,
      lines: [{ qty: 10 }],
      costInPaise: 12000,
      userId: "user-1",
      now: at,
    });
    expect(out.costInPaise).toBe(12000);
    expect(out.purchases).toMatchObject([
      { variantLabel: null, qty: 10, unitCostInPaise: 12000, purchasedAt: at.toISOString() },
    ]);

    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: s.candle.id } });
    expect(row.stockQty).toBe(15);
    // Rule 1: a count would forget the orders taken since; a purchase must not.
    expect(row.stockCountedAt?.toISOString()).toBe(countedAt.toISOString());
    expect(row.costInPaise).toBe(12000);
    expect((await inv.stockLeftByMenuItem(prisma, s.vendorId, [row])).get(row.id)).toBe(15);

    const saved = await prisma.stockPurchase.findMany({ where: { vendorId: s.vendorId } });
    expect(saved).toMatchObject([
      { menuItemId: s.candle.id, variantId: null, qty: 10, unitCostInPaise: 12000, createdByUserId: "user-1" },
    ]);
    expect(await ps.recentPurchases(prisma, s.vendorId, s.candle.id)).toHaveLength(1);
  });

  it("without a cost, keeps the cost on record and changes none", async () => {
    const s = await seed();
    const out = await receive({ vendorId: s.vendorId, menuItemId: s.candle.id, lines: [{ qty: 3 }] });
    expect(out.purchases[0].unitCostInPaise).toBe(10000);
    expect(out.costInPaise).toBe(10000);
    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: s.candle.id } });
    expect(row).toMatchObject({ stockQty: 8, costInPaise: 10000 });
  });

  it("receives by size: each count moves, a size with its own cost takes the new one, the rest the item's", async () => {
    const s = await seed();
    // No cost given: M is recorded at the item's ₹250, L at its own ₹300.
    const first = await receive({
      vendorId: s.vendorId,
      menuItemId: s.kurti.id,
      lines: [
        { variantId: s.m.id, qty: 4 },
        { variantId: s.l.id, qty: 6 },
      ],
    });
    expect(first.purchases.map((p) => [p.variantLabel, p.qty, p.unitCostInPaise])).toEqual([
      ["M", 4, 25000],
      ["L", 6, 30000],
    ]);

    const second = await receive({
      vendorId: s.vendorId,
      menuItemId: s.kurti.id,
      lines: [
        { variantId: s.m.id, qty: 1 },
        { variantId: s.l.id, qty: 1 },
      ],
      costInPaise: 27500,
    });
    expect(second.costInPaise).toBe(27500);

    const sizes = await prisma.itemVariant.findMany({ where: { menuItemId: s.kurti.id }, orderBy: { sortOrder: "asc" } });
    expect(sizes.map((v) => [v.label, v.stockQty, v.costInPaise])).toEqual([
      ["M", 7, null],
      ["L", 8, 27500],
      ["XL", null, null],
    ]);
    expect(sizes[0].stockCountedAt?.toISOString()).toBe(countedAt.toISOString());
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: s.kurti.id } })).costInPaise).toBe(27500);

    // Only L, which has its own cost: the item's cost stays.
    const third = await receive({
      vendorId: s.vendorId,
      menuItemId: s.kurti.id,
      lines: [{ variantId: s.l.id, qty: 1 }],
      costInPaise: 31000,
    });
    expect(third.costInPaise).toBe(27500);
    expect((await prisma.itemVariant.findUniqueOrThrow({ where: { id: s.l.id } })).costInPaise).toBe(31000);

    // Newest first, five at most.
    const recent = await ps.recentPurchases(prisma, s.vendorId, s.kurti.id);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toMatchObject({ variantLabel: "L", unitCostInPaise: 31000 });
  });

  it("keeps the size's name on a purchase after the size is deleted", async () => {
    const s = await seed();
    await receive({ vendorId: s.vendorId, menuItemId: s.kurti.id, lines: [{ variantId: s.m.id, qty: 2 }] });
    await prisma.itemVariant.delete({ where: { id: s.m.id } });
    expect(await ps.recentPurchases(prisma, s.vendorId, s.kurti.id)).toMatchObject([{ variantLabel: "M", qty: 2 }]);
  });

  it("refuses stock that is not tracked, a missing or foreign size, and writes nothing", async () => {
    const s = await seed();
    const other = await seed();
    const base = { vendorId: s.vendorId };

    expect(await refused({ ...base, menuItemId: s.scarf.id, lines: [{ qty: 1 }] })).toEqual({
      status: 409,
      code: "stock_not_tracked",
    });
    // One tracked size and one that is not: the whole delivery is refused.
    expect(
      await refused({
        ...base,
        menuItemId: s.kurti.id,
        lines: [
          { variantId: s.m.id, qty: 1 },
          { variantId: s.xl.id, qty: 1 },
        ],
      }),
    ).toEqual({ status: 409, code: "stock_not_tracked" });
    expect(await refused({ ...base, menuItemId: s.kurti.id, lines: [{ qty: 1 }] })).toEqual({
      status: 400,
      code: "size_required",
    });
    // A size on an item that has none, and another store's size or item.
    expect((await refused({ ...base, menuItemId: s.candle.id, lines: [{ variantId: s.m.id, qty: 1 }] })).status).toBe(404);
    expect((await refused({ ...base, menuItemId: s.kurti.id, lines: [{ variantId: other.m.id, qty: 1 }] })).status).toBe(404);
    expect((await refused({ ...base, menuItemId: other.candle.id, lines: [{ qty: 1 }], costInPaise: 1 })).status).toBe(404);

    expect(await prisma.stockPurchase.count({ where: { vendorId: { in: [s.vendorId, other.vendorId] } } })).toBe(0);
    expect((await prisma.itemVariant.findUniqueOrThrow({ where: { id: s.m.id } })).stockQty).toBe(2);
    expect(await prisma.menuItem.findUniqueOrThrow({ where: { id: other.candle.id } })).toMatchObject({
      stockQty: 5,
      costInPaise: 10000,
    });
    // Another store never reads these purchases.
    await receive({ vendorId: s.vendorId, menuItemId: s.candle.id, lines: [{ qty: 1 }] });
    expect(await ps.recentPurchases(prisma, other.vendorId, s.candle.id)).toEqual([]);
  });

  it("deleting the item takes its purchases with it", async () => {
    const s = await seed();
    await receive({ vendorId: s.vendorId, menuItemId: s.candle.id, lines: [{ qty: 1 }] });
    await prisma.menuItem.delete({ where: { id: s.candle.id } });
    expect(await prisma.stockPurchase.count({ where: { vendorId: s.vendorId } })).toBe(0);
  });
});
