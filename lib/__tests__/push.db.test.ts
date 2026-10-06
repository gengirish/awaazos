/**
 * Web Push — DB integration test for lib/push.ts sendToVendor and the
 * storefront order hook. Runs only with DROPS_DB_TEST=1 against a THROWAWAY
 * Postgres (never production); see lib/__tests__/drops.db.test.ts for the
 * docker / db push recipe, or `npm run test:drops:db`.
 *
 * web-push is mocked (sendNotification only — VAPID validation is real, with
 * a pair generated per run), so nothing leaves the machine.
 */
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addSubscription, clearVapidEnv, seedPushVendor, setFakeVapidEnv } from "./push-db-helpers";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const send = vi.hoisted(() => vi.fn());

vi.mock("web-push", async (importOriginal) => {
  const mod = await importOriginal<{ default?: Record<string, unknown> } & Record<string, unknown>>();
  const real = (mod.default ?? mod) as Record<string, unknown>;
  return { default: { ...real, sendNotification: send } };
});

type Seeded = Awaited<ReturnType<typeof seedPushVendor>>;

describe.skipIf(!ENABLED)("web push — DB integration", () => {
  let prisma: PrismaClient;
  let push: typeof import("@/lib/push");
  let menuOrders: typeof import("@/lib/menu-orders");
  const vendorIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("push.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    push = await import("@/lib/push");
    menuOrders = await import("@/lib/menu-orders");
    const webpush = (await import("web-push")).default;
    setFakeVapidEnv(webpush.generateVAPIDKeys);
    push.__resetPushConfigForTest();
    expect(push.isPushConfigured()).toBe(true);
  });

  afterAll(async () => {
    clearVapidEnv();
    push?.__resetPushConfigForTest();
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }); // cascades subs + staff
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  });

  async function seed(): Promise<Seeded> {
    const s = await seedPushVendor(prisma);
    vendorIds.push(s.vendor.id);
    userIds.push(...s.userIds);
    return s;
  }

  const payload = { title: "t", body: "b", url: "/orders", tag: "order-X" };
  const sentEndpoints = () => send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();

  it("sends only to the vendor's active staff (inactive staff and other vendors excluded)", async () => {
    const s = await seed();
    const other = await seed();
    const a1 = await addSubscription(prisma, s.vendor.id, s.owner.id);
    const a2 = await addSubscription(prisma, s.vendor.id, s.owner.id);
    const c1 = await addSubscription(prisma, s.vendor.id, s.cashier.id);
    await addSubscription(prisma, s.vendor.id, s.former.id);
    await addSubscription(prisma, other.vendor.id, other.owner.id);

    const r = await push.sendToVendor(s.vendor.id, payload);
    expect(r).toEqual({ sent: 3, removed: 0, failed: 0 });
    expect(sentEndpoints()).toEqual([a1.endpoint, a2.endpoint, c1.endpoint].sort());
    expect(JSON.parse(send.mock.calls[0]![1] as string)).toEqual(payload);
  });

  it("with userId, sends only to that user's devices", async () => {
    const s = await seed();
    const mine = await addSubscription(prisma, s.vendor.id, s.cashier.id);
    await addSubscription(prisma, s.vendor.id, s.owner.id);
    const r = await push.sendToVendor(s.vendor.id, payload, { userId: s.cashier.id });
    expect(r.sent).toBe(1);
    expect(sentEndpoints()).toEqual([mine.endpoint]);
  });

  it("deletes subscriptions the push service reports gone (404/410)", async () => {
    const s = await seed();
    const gone410 = await addSubscription(prisma, s.vendor.id, s.owner.id);
    const gone404 = await addSubscription(prisma, s.vendor.id, s.owner.id);
    const fine = await addSubscription(prisma, s.vendor.id, s.owner.id);
    send.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === gone410.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint === gone404.endpoint) throw Object.assign(new Error("Not found"), { statusCode: 404 });
      return { statusCode: 201 };
    });

    const r = await push.sendToVendor(s.vendor.id, payload);
    expect(r).toEqual({ sent: 1, removed: 2, failed: 0 });
    const left = await prisma.pushSubscription.findMany({ where: { vendorId: s.vendor.id }, select: { id: true } });
    expect(left.map((x) => x.id)).toEqual([fine.id]);
  });

  it("counts other errors, and deletes after the 5th consecutive failure", async () => {
    const s = await seed();
    const flaky = await addSubscription(prisma, s.vendor.id, s.owner.id, { failureCount: 1 });
    const dying = await addSubscription(prisma, s.vendor.id, s.owner.id, { failureCount: 4 });
    send.mockRejectedValue(Object.assign(new Error("Server error"), { statusCode: 500 }));

    const r = await push.sendToVendor(s.vendor.id, payload);
    expect(r).toEqual({ sent: 0, removed: 1, failed: 1 });
    expect((await prisma.pushSubscription.findUnique({ where: { id: flaky.id } }))?.failureCount).toBe(2);
    expect(await prisma.pushSubscription.findUnique({ where: { id: dying.id } })).toBeNull();
  });

  it("on success sets lastSuccessAt and resets failureCount", async () => {
    const s = await seed();
    const sub = await addSubscription(prisma, s.vendor.id, s.owner.id, { failureCount: 3 });
    const before = Date.now();
    await push.sendToVendor(s.vendor.id, payload);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.failureCount).toBe(0);
    expect(row.lastSuccessAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("is a no-op when VAPID env is missing", async () => {
    const s = await seed();
    await addSubscription(prisma, s.vendor.id, s.owner.id);
    const saved = { ...process.env };
    clearVapidEnv();
    push.__resetPushConfigForTest();
    try {
      expect(await push.sendToVendor(s.vendor.id, payload)).toEqual({ sent: 0, removed: 0, failed: 0 });
      expect(send).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = saved.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      process.env.VAPID_PRIVATE_KEY = saved.VAPID_PRIVATE_KEY;
      process.env.VAPID_SUBJECT = saved.VAPID_SUBJECT;
      push.__resetPushConfigForTest();
    }
  });

  it("placing a storefront order sends exactly one alert, with the bill number and no buyer PII", async () => {
    const s = await seed();
    await addSubscription(prisma, s.vendor.id, s.owner.id);
    const [chai, samosa] = s.vendor.menuItems; // ordered by name: Chai, Samosa

    const r = await menuOrders.placeMenuOrder({
      vendor: { id: s.vendor.id, plan: s.vendor.plan },
      settings: {
        acceptMenuOrders: true,
        acceptPayOnDelivery: true,
        menuFulfilmentMode: "PICKUP",
        menuDeliveryFeePaise: 0,
      },
      items: [
        { menuItemId: samosa!.id, qty: 2 },
        { menuItemId: chai!.id, qty: 1 },
      ],
      customerName: "Meera Iyer",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
    if (!r.ok) throw new Error(`order failed: ${r.error.code}`);

    await vi.waitFor(() => expect(send).toHaveBeenCalled(), { timeout: 5000 });
    // Let any stray second send surface before asserting "exactly one".
    await new Promise((res) => setTimeout(res, 200));
    expect(send).toHaveBeenCalledTimes(1);

    const body = send.mock.calls[0]![1] as string;
    const sent = JSON.parse(body) as { title: string; body: string; url: string; tag: string };
    expect(sent.body).toContain(r.order.billNumber);
    expect(sent.body).toContain("3 items");
    expect(sent.url).toBe("/orders");
    expect(sent.tag).toBe(`order-${r.order.billNumber}`);
    expect(body).not.toMatch(/Meera|Iyer|9876543210/);
  });
});
