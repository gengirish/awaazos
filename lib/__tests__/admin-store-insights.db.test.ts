/**
 * loadStoreHealth / listDemoPipeline — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";
const DAY = 86_400_000;

describe.skipIf(!ENABLED)("admin store insights — DB integration", () => {
  let prisma: PrismaClient;
  let health: typeof import("@/lib/admin-store-health");
  let demo: typeof import("@/lib/admin-demo-stores");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("admin-store-insights.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    ({ prisma } = await import("@/lib/prisma"));
    health = await import("@/lib/admin-store-health");
    demo = await import("@/lib/admin-demo-stores");
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.$disconnect();
  });

  async function vendor(data: Record<string, unknown> = {}) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `insights-test-${tag}`,
        name: `Insights Test ${tag}`,
        ownerName: "Test Owner",
        phone: "+919876543210",
        email: `owner-${tag}@example.com`,
        ...data,
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  const txn = (vendorId: string, createdAt: Date, isSample = false) =>
    prisma.transaction.create({
      data: {
        vendorId,
        billNumber: `TEST-${randomBytes(4).toString("hex")}`,
        subtotalPaise: 100,
        totalPaise: 100,
        paymentStatus: "PAID",
        source: "MANUAL",
        isSample,
        createdAt,
      },
    });

  const drop = (vendorId: string, closesAt: Date, status: "DRAFT" | "OPEN" | "CLOSED") =>
    prisma.drop.create({
      data: {
        vendorId,
        title: "Test drop",
        date: new Date(closesAt.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentStartsAt: new Date(closesAt.getTime() + DAY),
        fulfilmentEndsAt: new Date(closesAt.getTime() + DAY + 3_600_000),
        closesAt,
        status,
      },
    });

  it("reads last real order, published flag and this week's non-draft drops", async () => {
    const now = new Date();
    const busy = await vendor({ settings: { create: { publishStorefront: true } } });
    const idle = await vendor({ settings: { create: {} } });
    const bare = await vendor();

    const realAt = new Date(now.getTime() - 2 * DAY);
    await txn(busy.id, new Date(now.getTime() - 9 * DAY));
    await txn(busy.id, realAt);
    await txn(busy.id, new Date(now.getTime() - 60_000), true); // demo sample: ignored
    await txn(idle.id, new Date(now.getTime() - 60_000), true);

    await drop(busy.id, new Date(now.getTime() + DAY), "OPEN");
    await drop(busy.id, new Date(now.getTime() - 2 * DAY), "CLOSED");
    await drop(busy.id, new Date(now.getTime() + DAY), "DRAFT"); // draft: ignored
    await drop(busy.id, new Date(now.getTime() - 20 * DAY), "CLOSED"); // too old: ignored

    const map = await health.loadStoreHealth([busy.id, idle.id, bare.id], now);
    expect(health.healthFor(map, busy.id)).toEqual({ lastOrderAt: realAt, published: true, dropsThisWeek: 2 });
    expect(health.healthFor(map, idle.id)).toEqual({ lastOrderAt: null, published: false, dropsThisWeek: 0 });
    expect(health.healthFor(map, bare.id)).toEqual({ lastOrderAt: null, published: false, dropsThisWeek: 0 });
    expect(await health.loadStoreHealth([], now)).toEqual(new Map());
  });

  it("lists demo stores, claimed ones included, never ordinary stores", async () => {
    const now = new Date();
    const ref = `ref-${randomBytes(4).toString("hex")}`;
    const pending = await vendor({ isDemo: true, demoExternalRef: `${ref}-a` });
    const claimed = await vendor({ isDemo: false, demoExternalRef: `${ref}-b` });
    const ordinary = await vendor();
    await prisma.demoHandover.create({
      data: {
        vendorId: pending.id,
        email: "prospect@example.com",
        tokenHash: randomBytes(16).toString("hex"),
        expiresAt: new Date(now.getTime() + 3 * DAY),
      },
    });
    const usedAt = new Date(now.getTime() - DAY);
    await prisma.demoHandover.create({
      data: {
        vendorId: claimed.id,
        email: "prospect@example.com",
        tokenHash: randomBytes(16).toString("hex"),
        expiresAt: new Date(now.getTime() + DAY),
        usedAt,
      },
    });

    const rows = await demo.listDemoPipeline();
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([pending.id, claimed.id]));
    expect(ids).not.toContain(ordinary.id);
    // The prospect's email is never selected.
    expect(JSON.stringify(rows)).not.toContain("prospect@example.com");

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(demo.demoStage(byId.get(pending.id)!, now).kind).toBe("invited");
    expect(demo.demoStage(byId.get(claimed.id)!, now)).toEqual({ kind: "claimed", claimedAt: usedAt });
  });
});
