/**
 * Everyday-menu controls DB integration test — runs only with DROPS_DB_TEST=1
 * against a THROWAWAY Postgres (never production). Included in
 * `npm run test:drops:db`, or:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/menu-visibility.db.test.ts
 *
 * Covers `Drop.showEverydayMenu` (an open drop with it false pauses menu
 * orders) and `MenuItem.showOnline` (counter-only items can't be ordered).
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

type MenuOrdersModule = typeof import("@/lib/menu-orders");
type PrismaModule = typeof import("@/lib/prisma");

const H = 60 * 60 * 1000;

describe.skipIf(!ENABLED)("everyday menu visibility — DB integration", () => {
  let mo: MenuOrdersModule;
  let prisma: PrismaModule["prisma"];
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("menu-visibility.db.test refuses to run against a non-local DATABASE_URL");
    }
    mo = await import("@/lib/menu-orders");
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

  async function seed() {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `menu-vis-${tag}`,
        name: `Menu Vis ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true } },
        menuItems: {
          create: [
            { name: "Vada Pav", priceInPaise: 2500 },
            { name: "Counter Chai", priceInPaise: 1500, showOnline: false },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    const vada = vendor.menuItems.find((m) => m.name === "Vada Pav")!;
    const chai = vendor.menuItems.find((m) => m.name === "Counter Chai")!;
    return { vendor, vada, chai };
  }

  async function addDrop(
    vendorId: string,
    menuItemId: string,
    opts: { showEverydayMenu: boolean; opensAt?: Date | null; closesAt?: Date },
  ) {
    const now = Date.now();
    return prisma.drop.create({
      data: {
        vendorId,
        title: "Today's special",
        date: new Date(new Date(now + 24 * H).toISOString().slice(0, 10)),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now + 20 * H),
        fulfilmentEndsAt: new Date(now + 22 * H),
        opensAt: opts.opensAt ?? null,
        closesAt: opts.closesAt ?? new Date(now + 6 * H),
        status: "OPEN",
        showEverydayMenu: opts.showEverydayMenu,
        items: { create: [{ menuItemId, priceInPaise: 9900, maxQty: 10 }] },
      },
    });
  }

  function order(vendor: { id: string }, menuItemId: string) {
    return mo.placeMenuOrder({
      vendor: { id: vendor.id, plan: "PRO" },
      settings: {
        acceptMenuOrders: true,
        acceptPayOnDelivery: true,
        menuFulfilmentMode: "PICKUP",
        menuDeliveryFeePaise: 0,
      },
      items: [{ menuItemId, qty: 1 }],
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
  }

  it("an open drop with showEverydayMenu=false pauses menu orders", async () => {
    const { vendor, vada } = await seed();
    await addDrop(vendor.id, vada.id, { showEverydayMenu: false });
    expect(await mo.everydayMenuHiddenByDrop(prisma, vendor.id)).toBe(true);
    const res = await order(vendor, vada.id);
    expect(res).toEqual({ ok: false, error: { code: "menu_paused_for_drop" } });
  });

  it("an open drop with showEverydayMenu=true keeps menu orders working", async () => {
    const { vendor, vada } = await seed();
    await addDrop(vendor.id, vada.id, { showEverydayMenu: true });
    expect(await mo.everydayMenuHiddenByDrop(prisma, vendor.id)).toBe(false);
    const res = await order(vendor, vada.id);
    expect(res.ok).toBe(true);
  });

  it("a scheduled drop (opensAt in the future) does not pause menu orders", async () => {
    const { vendor, vada } = await seed();
    await addDrop(vendor.id, vada.id, { showEverydayMenu: false, opensAt: new Date(Date.now() + 2 * H) });
    expect(await mo.everydayMenuHiddenByDrop(prisma, vendor.id)).toBe(false);
    const res = await order(vendor, vada.id);
    expect(res.ok).toBe(true);
  });

  it("a drop past its cut-off does not pause menu orders", async () => {
    const { vendor, vada } = await seed();
    await addDrop(vendor.id, vada.id, { showEverydayMenu: false, closesAt: new Date(Date.now() - H) });
    const res = await order(vendor, vada.id);
    expect(res.ok).toBe(true);
  });

  it("a showOnline=false item can't be ordered from the storefront", async () => {
    const { vendor, chai } = await seed();
    const res = await order(vendor, chai.id);
    expect(res).toEqual({ ok: false, error: { code: "item_not_found", menuItemId: chai.id } });
  });

  it("another vendor's hiding drop doesn't pause this vendor's menu", async () => {
    const a = await seed();
    const b = await seed();
    await addDrop(a.vendor.id, a.vada.id, { showEverydayMenu: false });
    const res = await order(b.vendor, b.vada.id);
    expect(res.ok).toBe(true);
  });
});
