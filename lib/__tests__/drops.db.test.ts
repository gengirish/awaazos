/**
 * Drops DB integration test — runs only with DROPS_DB_TEST=1 against a
 * THROWAWAY Postgres (never production). See `npm run test:drops:db`.
 *
 *   docker run -d --name awaazos-drops -p 5434:5432 -e POSTGRES_USER=ci \
 *     -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=awaazos postgres:15-alpine
 *   DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=... npx vitest run lib/__tests__/drops.db.test.ts
 *
 * Modules that touch Prisma are imported lazily so a plain `npm test` (no env)
 * can still load this file and skip it.
 */
import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type DropsModule = typeof import("@/lib/drops");
type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("drops — DB integration", () => {
  let drops: DropsModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];
  const MIN = 60_000;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("drops.db.test refuses to run against a non-local DATABASE_URL");
    }
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

  async function seed(opts: { maxQty?: number | null; closesAt?: Date } = {}) {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `drops-test-${tag}`,
        name: `Drops Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        settings: { create: { publishStorefront: true, acceptPayOnDelivery: true } },
        menuItems: {
          create: [
            { name: "Ragi laddu", priceInPaise: 12000 },
            { name: "Thepla", priceInPaise: 4550 },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const now = new Date();
    const drop = await prisma.drop.create({
      data: {
        vendorId: vendor.id,
        title: "Saturday Bakes",
        date: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "BOTH",
        fulfilmentStartsAt: new Date(now.getTime() + 2 * 24 * 60 * MIN),
        fulfilmentEndsAt: new Date(now.getTime() + 2 * 24 * 60 * MIN + 3 * 60 * MIN),
        deliveryFeePaise: 3000,
        closesAt: opts.closesAt ?? new Date(now.getTime() + 24 * 60 * MIN),
        status: "OPEN",
        items: {
          create: vendor.menuItems.map((m, i) => ({
            menuItemId: m.id,
            priceInPaise: m.priceInPaise,
            maxQty: i === 0 ? (opts.maxQty === undefined ? 5 : opts.maxQty) : null,
            sortOrder: i,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return { vendor: { id: vendor.id, plan: vendor.plan }, drop, cappedItem: drop.items[0], openItem: drop.items[1] };
  }

  function order(
    s: Awaited<ReturnType<typeof seed>>,
    over: Partial<Parameters<DropsModule["placeStorefrontOrder"]>[0]> = {},
  ) {
    return drops.placeStorefrontOrder({
      vendor: s.vendor,
      acceptPayOnDelivery: true,
      dropId: s.drop.id,
      items: [{ dropItemId: s.cappedItem.id, qty: 1 }],
      customerName: "Meera",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "UPI",
      ...over,
    });
  }

  it("(a) 10 concurrent orders for the last 5 units: exactly 5 succeed, 5 sold_out", async () => {
    const s = await seed({ maxQty: 5 });
    const results = await Promise.all(Array.from({ length: 10 }, () => order(s)));

    const ok = results.filter((r) => r.ok);
    const soldOut = results.filter((r) => !r.ok && r.error.code === "sold_out");
    expect(ok).toHaveLength(5);
    expect(soldOut).toHaveLength(5);

    const sold = await drops.soldQtyByDropItem(prisma, s.drop.id);
    expect(sold.get(s.cappedItem.id)).toBe(5);

    const bills = new Set(ok.map((r) => (r.ok ? r.order.billNumber : "")));
    expect(bills.size).toBe(5); // bill sequence stayed unique under contention
    for (const r of ok) if (r.ok) expect(r.order.totalPaise).toBe(12000); // pickup: no fee
  }, 30_000);

  it("(b) SQL stockHoldingOrderWhere and pure orderHoldsStock agree", async () => {
    const s = await seed({ maxQty: null });
    const base = new Date();
    const mk = (
      label: string,
      minsAgo: number,
      data: Partial<Prisma.TransactionUncheckedCreateInput> = {},
    ) =>
      prisma.transaction.create({
        data: {
          vendorId: s.vendor.id,
          billNumber: `TEST-${label}-${randomBytes(3).toString("hex")}`,
          subtotalPaise: 100,
          totalPaise: 100,
          paymentMethod: "UPI",
          paymentStatus: "PENDING",
          source: "STOREFRONT",
          dropId: s.drop.id,
          fulfilmentStatus: "PLACED",
          fulfilmentType: "PICKUP",
          createdAt: new Date(base.getTime() - minsAgo * MIN),
          ...data,
        },
      });

    await Promise.all([
      mk("paid", 120, { paymentStatus: "PAID", paidAt: base }),
      mk("cash", 120, { paymentMethod: "CASH" }),
      mk("utr", 120, { upiRef: "412345678901" }),
      mk("expired", 20),
      mk("fresh", 5),
      mk("boundary", 15), // exactly at the hold edge when now = base
      mk("cancelled", 1, { fulfilmentStatus: "CANCELLED" }),
      mk("refunded", 120, { fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED" }),
      mk("confirmed", 120, { fulfilmentStatus: "CONFIRMED" }),
      mk("delivered", 120, { fulfilmentStatus: "DELIVERED" }),
    ]);

    const all = await prisma.transaction.findMany({
      where: { dropId: s.drop.id },
      select: {
        id: true,
        billNumber: true,
        fulfilmentStatus: true,
        paymentStatus: true,
        paymentMethod: true,
        upiRef: true,
        createdAt: true,
      },
    });
    expect(all).toHaveLength(10);

    const instants = [
      base,
      new Date(base.getTime() - 1),
      new Date(base.getTime() + 1),
      new Date(base.getTime() + 10 * MIN), // "fresh" hits its edge
      new Date(base.getTime() + 11 * MIN),
      new Date(base.getTime() - 10 * MIN),
      new Date(base.getTime() + 24 * 60 * MIN),
    ];
    for (const now of instants) {
      const sql = await prisma.transaction.findMany({
        where: { dropId: s.drop.id, ...drops.stockHoldingOrderWhere(now) },
        select: { billNumber: true },
      });
      const sqlSet = sql.map((t) => t.billNumber).sort();
      const pureSet = all
        .filter((t) => drops.orderHoldsStock(t, now))
        .map((t) => t.billNumber)
        .sort();
      expect({ now: now.toISOString(), set: sqlSet }).toEqual({ now: now.toISOString(), set: pureSet });
    }

    const at = (label: string) => all.find((t) => t.billNumber.startsWith(`TEST-${label}-`))!;
    expect(drops.orderHoldsStock(at("boundary"), base)).toBe(false);
    expect(drops.orderHoldsStock(at("fresh"), base)).toBe(true);
    expect(drops.orderHoldsStock(at("expired"), base)).toBe(false);
  });

  it("(c) markOrderPaid credits DailySummary once; cancelOrder reverses it and frees stock", async () => {
    const s = await seed({ maxQty: 5 });
    const placed = await order(s, {
      items: [
        { dropItemId: s.cappedItem.id, qty: 2 },
        { dropItemId: s.openItem.id, qty: 1 },
      ],
      fulfilmentType: "DELIVERY",
      deliveryAddress: "12 MG Road",
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.order.subtotalPaise).toBe(2 * 12000 + 4550);
    expect(placed.order.totalPaise).toBe(2 * 12000 + 4550 + 3000);

    const now = new Date();
    const { getIstTodayStart } = await import("@/lib/billing-period");
    const summary = () =>
      prisma.dailySummary.findUnique({
        where: { vendorId_date: { vendorId: s.vendor.id, date: getIstTodayStart(now) } },
      });

    // Unpaid orders don't touch revenue.
    expect(await summary()).toBeNull();

    const args = { vendorId: s.vendor.id, transactionId: placed.order.id, upiRef: "412345678901", now };
    expect(await prisma.$transaction((tx) => drops.markOrderPaid(tx, args))).toBe(true);
    expect(await prisma.$transaction((tx) => drops.markOrderPaid(tx, args))).toBe(false);

    let ds = await summary();
    expect(ds).toMatchObject({
      totalRevenuePaise: placed.order.totalPaise,
      totalTransactions: 1,
      totalItemsSold: 3,
      upiRevenuePaise: placed.order.totalPaise,
      cashRevenuePaise: 0,
    });

    // Another vendor can't mark it paid.
    const other = await seed();
    expect(
      await prisma.$transaction((tx) =>
        drops.markOrderPaid(tx, { vendorId: other.vendor.id, transactionId: placed.order.id, now }),
      ),
    ).toBe(false);

    expect((await drops.soldQtyByDropItem(prisma, s.drop.id)).get(s.cappedItem.id)).toBe(2);

    expect(
      await prisma.$transaction((tx) =>
        drops.cancelOrder(tx, { vendorId: s.vendor.id, transactionId: placed.order.id, now }),
      ),
    ).toBe(true);
    // Cancelling twice is a no-op.
    expect(
      await prisma.$transaction((tx) =>
        drops.cancelOrder(tx, { vendorId: s.vendor.id, transactionId: placed.order.id, now }),
      ),
    ).toBe(false);

    ds = await summary();
    expect(ds).toMatchObject({
      totalRevenuePaise: 0,
      totalTransactions: 0,
      totalItemsSold: 0,
      upiRevenuePaise: 0,
      cashRevenuePaise: 0,
    });

    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(t.fulfilmentStatus).toBe("CANCELLED");
    expect(t.paymentStatus).toBe("REFUNDED");
    expect((await drops.soldQtyByDropItem(prisma, s.drop.id)).get(s.cappedItem.id) ?? 0).toBe(0);

    // A cancelled order can't be paid afterwards.
    expect(await prisma.$transaction((tx) => drops.markOrderPaid(tx, args))).toBe(false);
  });

  it("(d) unpaid storefront orders don't count toward the monthly cap", async () => {
    const s = await seed({ maxQty: null });
    await prisma.transaction.create({
      data: {
        vendorId: s.vendor.id,
        billNumber: `TEST-counter-${randomBytes(3).toString("hex")}`,
        subtotalPaise: 5000,
        totalPaise: 5000,
        paymentStatus: "PAID",
        source: "MANUAL",
      },
    });
    const a = await order(s);
    const b = await order(s, { paymentMethod: "CASH" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok) return;

    expect(await drops.countBillableTxnThisMonth(prisma, s.vendor.id)).toBe(1);

    await prisma.$transaction((tx) =>
      drops.markOrderPaid(tx, { vendorId: s.vendor.id, transactionId: a.order.id }),
    );
    expect(await drops.countBillableTxnThisMonth(prisma, s.vendor.id)).toBe(2);
  });

  it("(d2) billableTxnWhere and billableTxnSql select the same rows", async () => {
    const s = await seed({ maxQty: null });
    const mk = (label: string, data: Partial<Prisma.TransactionUncheckedCreateInput>) =>
      prisma.transaction.create({
        data: {
          vendorId: s.vendor.id,
          billNumber: `TEST-${label}-${randomBytes(3).toString("hex")}`,
          subtotalPaise: 100,
          totalPaise: 100,
          ...data,
        },
      });
    const sf = { source: "STOREFRONT", dropId: s.drop.id, fulfilmentType: "PICKUP" } as const;
    await Promise.all([
      mk("voice-paid", { source: "VOICE", paymentStatus: "PAID" }),
      mk("manual-pending", { source: "MANUAL", paymentStatus: "PENDING" }),
      mk("api-failed", { source: "API", paymentStatus: "FAILED" }),
      mk("sf-paid", { ...sf, paymentStatus: "PAID", paidAt: new Date(), fulfilmentStatus: "CONFIRMED" }),
      mk("sf-pending", { ...sf, paymentStatus: "PENDING", fulfilmentStatus: "PLACED" }),
      mk("sf-cod", { ...sf, paymentMethod: "CASH", paymentStatus: "PENDING", fulfilmentStatus: "PLACED" }),
      mk("sf-refunded", { ...sf, paymentStatus: "REFUNDED", fulfilmentStatus: "CANCELLED" }),
    ]);

    const viaWhere = (
      await prisma.transaction.findMany({
        where: { vendorId: s.vendor.id, ...drops.billableTxnWhere() },
        select: { billNumber: true },
      })
    )
      .map((t) => t.billNumber.split("-")[1] + "-" + t.billNumber.split("-")[2])
      .sort();
    const { Prisma: P } = await import("@prisma/client");
    const viaSql = (
      await prisma.$queryRaw<{ billNumber: string }[]>(P.sql`
        SELECT t."billNumber" FROM transactions t
        WHERE t."vendorId" = ${s.vendor.id} AND ${drops.billableTxnSql}
      `)
    )
      .map((t) => t.billNumber.split("-")[1] + "-" + t.billNumber.split("-")[2])
      .sort();

    expect(viaWhere).toEqual(["api-failed", "manual-pending", "sf-paid", "voice-paid"]);
    expect(viaSql).toEqual(viaWhere);
    expect(await drops.countBillableTxnThisMonth(prisma, s.vendor.id)).toBe(4);
  });

  it("(e) an OPEN drop past closesAt rejects with drop_not_open", async () => {
    const s = await seed();
    const after = new Date(s.drop.closesAt.getTime() + MIN);
    const r = await order(s, { now: after });
    expect(r).toEqual({ ok: false, error: { code: "drop_not_open" } });

    const exactly = await order(s, { now: s.drop.closesAt });
    expect(exactly).toEqual({ ok: false, error: { code: "drop_not_open" } });

    const past = await seed({ closesAt: new Date(Date.now() - MIN) });
    expect(await order(past)).toEqual({ ok: false, error: { code: "drop_not_open" } });
  });

  it("(f) a dropId belonging to another vendor is drop_not_found", async () => {
    const mine = await seed();
    const theirs = await seed();
    const r = await order(mine, { dropId: theirs.drop.id, items: [{ dropItemId: theirs.cappedItem.id, qty: 1 }] });
    expect(r).toEqual({ ok: false, error: { code: "drop_not_found" } });
    expect(await prisma.transaction.count({ where: { dropId: theirs.drop.id } })).toBe(0);
  });

  it("rejects items from another drop, per-order limits and missing delivery address", async () => {
    const s = await seed();
    const other = await seed();
    expect(await order(s, { items: [{ dropItemId: other.cappedItem.id, qty: 1 }] })).toEqual({
      ok: false,
      error: { code: "item_not_found", dropItemId: other.cappedItem.id },
    });
    expect(await order(s, { fulfilmentType: "DELIVERY", deliveryAddress: "  " })).toEqual({
      ok: false,
      error: { code: "address_required" },
    });
    await prisma.dropItem.update({ where: { id: s.cappedItem.id }, data: { perOrderLimit: 2 } });
    expect(await order(s, { items: [{ dropItemId: s.cappedItem.id, qty: 3 }] })).toEqual({
      ok: false,
      error: { code: "per_order_limit", dropItemId: s.cappedItem.id, limit: 2 },
    });
    expect(await order(s, { paymentMethod: "CASH", acceptPayOnDelivery: false })).toEqual({
      ok: false,
      error: { code: "pay_on_delivery_disabled" },
    });
  });
});
