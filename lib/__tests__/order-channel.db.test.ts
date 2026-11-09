/**
 * Order source through the real order routes and metrics query. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

vi.hoisted(() => {
  // Rate limiters must stay local (fail-open): never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

vi.mock("@/lib/customer-auth", () => ({ getCurrentCustomer: async () => null }));

const MIN = 60 * 1000;
const IG = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 310.0.0 (iPhone14,5)";
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";

describe.skipIf(!ENABLED)("order channel — DB integration", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("order-channel.db.test refuses to run against a non-local DATABASE_URL");
    }
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
        slug: `channel-test-${tag}`,
        name: `Channel Test ${tag}`,
        ownerName: "Owner",
        plan: "PRO",
        upiId: "kitchen@upi",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true } },
        menuItems: { create: [{ name: "Samosa", priceInPaise: 2000 }] },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    return vendor;
  }

  /** An open drop pauses menu orders, so only the drop test gets one. */
  async function seedDrop(vendor: { id: string; menuItems: { id: string }[] }) {
    const now = Date.now();
    return prisma.drop.create({
      data: {
        vendorId: vendor.id,
        title: "Saturday Bakes",
        date: new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now + 2 * 24 * 60 * MIN),
        fulfilmentEndsAt: new Date(now + 2 * 24 * 60 * MIN + 180 * MIN),
        closesAt: new Date(now + 24 * 60 * MIN),
        status: "OPEN",
        items: { create: [{ menuItemId: vendor.menuItems[0]!.id, priceInPaise: 2000, sortOrder: 0 }] },
      },
      include: { items: true },
    });
  }

  const BUYER = {
    customerName: "Test Buyer",
    customerPhone: "+919876543210",
    fulfilmentType: "PICKUP",
    paymentMethod: "UPI",
  };

  function post(url: string, userAgent: string, body: Record<string, unknown>) {
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent },
      body: JSON.stringify(body),
    });
  }

  async function menuOrder(
    vendor: { slug: string; menuItems: { id: string }[] },
    userAgent: string,
    extra: Record<string, unknown> = {},
  ) {
    const { POST } = await import("@/app/api/s/[slug]/menu-orders/route");
    const items = [{ menuItemId: vendor.menuItems[0]!.id, qty: 1 }];
    const res = await POST(post("http://x.test/o", userAgent, { ...BUYER, items, ...extra }), {
      params: Promise.resolve({ slug: vendor.slug }),
    });
    return { status: res.status, json: (await res.json()) as { data: { billNumber: string } } };
  }

  async function channelOf(vendorId: string, billNumber: string) {
    const row = await prisma.transaction.findFirst({
      where: { vendorId, billNumber },
      select: { orderChannel: true },
    });
    return row?.orderChannel;
  }

  it("records Instagram from the browser or the tag, and nothing otherwise", async () => {
    const vendor = await seed();

    const inApp = await menuOrder(vendor, IG);
    expect(inApp.status).toBe(201);
    expect(await channelOf(vendor.id, inApp.json.data.billNumber)).toBe("instagram");

    const tagged = await menuOrder(vendor, CHROME, { src: "ig" });
    expect(await channelOf(vendor.id, tagged.json.data.billNumber)).toBe("instagram");

    const plain = await menuOrder(vendor, CHROME);
    expect(await channelOf(vendor.id, plain.json.data.billNumber)).toBeNull();
  });

  it("records it on a drop order too", async () => {
    const vendor = await seed();
    const drop = await seedDrop(vendor);
    const { POST } = await import("@/app/api/s/[slug]/orders/route");
    const items = [{ dropItemId: drop.items[0]!.id, qty: 1 }];
    const res = await POST(post("http://x.test/o", IG, { ...BUYER, dropId: drop.id, items }), {
      params: Promise.resolve({ slug: vendor.slug }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { billNumber: string } };
    expect(await channelOf(vendor.id, json.data.billNumber)).toBe("instagram");
  });

  it("rejects an unknown src instead of storing it", async () => {
    const vendor = await seed();
    expect((await menuOrder(vendor, CHROME, { src: "evil" })).status).toBe(400);
  });

  it("counts them on the admin metrics, leaving out demo stores", async () => {
    const { getAdminMetrics } = await import("@/lib/admin-metrics");
    // The windows are complete IST days, so today's orders appear in tomorrow's report.
    const tomorrow = () => new Date(Date.now() + 86_400_000);
    const instagramOf = async () => {
      const { since: _since, ...counts } = (await getAdminMetrics(tomorrow())).instagram;
      return counts;
    };
    const before = await instagramOf();

    const vendor = await seed();
    await menuOrder(vendor, IG);
    const { json } = await menuOrder(vendor, IG);
    await menuOrder(vendor, CHROME);
    await prisma.transaction.updateMany({
      where: { vendorId: vendor.id, billNumber: json.data.billNumber },
      data: { paymentStatus: "PAID", paidAt: new Date() },
    });

    const demo = await seed();
    await menuOrder(demo, IG);
    await prisma.vendor.update({ where: { id: demo.id }, data: { isDemo: true } });

    expect(await instagramOf()).toEqual({
      orders: before.orders + 2,
      paid: before.paid + 1,
      storefrontOrdersSince: before.storefrontOrdersSince + 3,
      storefrontOrders: before.storefrontOrders + 3,
    });
  });
});
