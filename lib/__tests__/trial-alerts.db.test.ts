/**
 * Trial alerts through the real routes and Prisma queries. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 * Email, push and Upstash are faked; nothing leaves the machine.
 */
import { randomBytes } from "node:crypto";

import type { Redis } from "@upstash/redis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => {
  // Rate limiters must stay local (fail-open): never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    reminder: vi.fn(async (_input: { to: string; storeName: string; daysLeft: number }) => ({ delivered: true })),
    locked: vi.fn(async (_input: { to: string; storeName: string }) => ({ delivered: true })),
    push: vi.fn(async (..._args: unknown[]) => ({ sent: 1, removed: 0, failed: 0 })),
  };
});

vi.mock("@/lib/email", () => ({ sendTrialReminderEmail: h.reminder, sendStoreLockedEmail: h.locked }));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendToVendor: h.push,
}));
vi.mock("@/lib/customer-auth", () => ({ getCurrentCustomer: async () => null }));

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeKv() {
  const store = new Map<string, unknown>();
  return {
    async set(k: string, v: unknown, o?: { nx?: boolean }) {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    },
    async del(k: string) {
      return store.delete(k) ? 1 : 0;
    },
  };
}

describe.skipIf(!ENABLED)("trial alerts — DB integration", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let setKv: typeof import("@/lib/kv").__setKvForTest;
  const vendorIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("trial-alerts.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    ({ __setKvForTest: setKv } = await import("@/lib/kv"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setKv(fakeKv() as unknown as Redis);
  });

  afterAll(async () => {
    if (!prisma) return;
    setKv(null);
    await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function seed(over: {
    trialEndsAt: Date | null;
    plan?: "FREE" | "STARTER";
    planExpiresAt?: Date;
    isDemo?: boolean;
    isActive?: boolean;
  }) {
    const tag = randomBytes(5).toString("hex");
    const mkUser = (who: string) =>
      prisma.user.create({ data: { email: `alert-${who}-${tag}@example.test`, name: who } });
    const [owner, cashier] = await Promise.all([mkUser("owner"), mkUser("cashier")]);
    userIds.push(owner.id, cashier.id);
    const vendor = await prisma.vendor.create({
      data: {
        slug: `alert-test-${tag}`,
        name: `Alert Test ${tag}`,
        ownerName: "Owner",
        plan: over.plan ?? "FREE",
        planExpiresAt: over.planExpiresAt ?? null,
        trialEndsAt: over.trialEndsAt,
        isDemo: over.isDemo ?? false,
        isActive: over.isActive ?? true,
        upiId: "kitchen@upi",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true } },
        menuItems: { create: [{ name: "Samosa", priceInPaise: 2000 }] },
        staff: {
          create: [
            { userId: owner.id, name: "Owner", role: "OWNER" },
            { userId: cashier.id, name: "Cashier", role: "CASHIER" },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(vendor.id);
    return { vendor, owner, cashier };
  }

  async function runCron() {
    process.env.CRON_SECRET = "a-long-enough-test-secret";
    const { GET } = await import("@/app/api/cron/trial-reminders/route");
    return GET(
      new Request("http://x.test/api/cron/trial-reminders", {
        headers: { authorization: "Bearer a-long-enough-test-secret" },
      }),
    );
  }

  function placeMenuOrder(vendor: { slug: string; menuItems: { id: string }[] }) {
    return import("@/app/api/s/[slug]/menu-orders/route").then(({ POST }) =>
      POST(
        new Request(`http://x.test/api/s/${vendor.slug}/menu-orders`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${vendorIds.length}` },
          body: JSON.stringify({
            items: [{ menuItemId: vendor.menuItems[0]!.id, qty: 1 }],
            customerName: "Test Buyer",
            customerPhone: "+919876543210",
            fulfilmentType: "PICKUP",
            paymentMethod: "UPI",
          }),
        }),
        { params: Promise.resolve({ slug: vendor.slug }) },
      ),
    );
  }

  it("the cron refuses a bad secret before reading anything", async () => {
    process.env.CRON_SECRET = "a-long-enough-test-secret";
    const { GET } = await import("@/app/api/cron/trial-reminders/route");
    const res = await GET(new Request("http://x.test/api/cron/trial-reminders"));
    expect(res.status).toBe(401);
    expect(h.reminder).not.toHaveBeenCalled();
  });

  it("reminds the owner of a trial ending soon, and nobody else", async () => {
    const soon = new Date(Date.now() + 3 * DAY_MS);
    const due = await seed({ trialEndsAt: soon });
    const demo = await seed({ trialEndsAt: soon, isDemo: true });
    const inactive = await seed({ trialEndsAt: soon, isActive: false });
    const subscribed = await seed({ trialEndsAt: soon, plan: "STARTER", planExpiresAt: soon });
    const far = await seed({ trialEndsAt: new Date(Date.now() + 20 * DAY_MS) });
    const ended = await seed({ trialEndsAt: new Date(Date.now() - DAY_MS) });
    const grandfathered = await seed({ trialEndsAt: null });

    const res = await runCron();
    expect(res.status).toBe(200);

    const to = h.reminder.mock.calls.map(([input]) => input.to);
    expect(to).toContain(due.owner.email);
    expect(to).not.toContain(due.cashier.email);
    for (const other of [demo, inactive, subscribed, far, ended, grandfathered]) {
      expect(to).not.toContain(other.owner.email);
    }

    const before = h.reminder.mock.calls.length;
    await runCron();
    expect(h.reminder.mock.calls.length).toBe(before);
  });

  it("a buyer at a locked store gets orders_paused and the owner hears once", async () => {
    const { vendor, owner, cashier } = await seed({ trialEndsAt: new Date(Date.now() - DAY_MS) });

    const first = await placeMenuOrder(vendor);
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ error: "orders_paused" });
    await vi.waitFor(() => expect(h.locked).toHaveBeenCalledTimes(1));

    const second = await placeMenuOrder(vendor);
    expect(second.status).toBe(409);
    await new Promise((r) => setTimeout(r, 50));

    expect(h.locked).toHaveBeenCalledTimes(1);
    expect(h.locked.mock.calls[0]?.[0].to).toBe(owner.email);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0]?.[2]).toEqual({ userId: owner.id });
    expect(h.locked.mock.calls[0]?.[0].to).not.toBe(cashier.email);
    expect(await prisma.transaction.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

  it("a store still on its trial takes the order and sends no alert", async () => {
    const { vendor } = await seed({ trialEndsAt: new Date(Date.now() + 10 * DAY_MS) });
    const res = await placeMenuOrder(vendor);
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.locked).not.toHaveBeenCalled();
  });
});
