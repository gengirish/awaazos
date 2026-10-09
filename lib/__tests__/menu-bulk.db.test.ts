/**
 * POST /api/menu/bulk (voice menu builder save) — DB integration test. Runs
 * only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production);
 * see lib/__tests__/drops.db.test.ts for the docker / db push recipe.
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/menu-bulk.db.test.ts
 *
 * Drives the real handlers with requireVendorRole mocked (rate limiter and
 * idempotency fail open without Upstash):
 * - creates + price updates land in one call, with POST /api/menu's slug /
 *   alias / sortOrder rules;
 * - another vendor's id is skipped as not_found and that row never changes;
 * - slugs dedupe against existing rows and within the batch;
 * - POST /api/menu still behaves as before (shared helper extraction).
 */
import { randomBytes } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const auth = vi.hoisted(() => ({ vendor: null as unknown }));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    requireVendorRole: vi.fn(async () => {
      if (!auth.vendor) throw new AuthError(401, "Unauthorized");
      return { user: {}, staff: { role: "CASHIER" }, vendor: auth.vendor, setVendorCookie: null };
    }),
  };
});

type PrismaModule = typeof import("@/lib/prisma");
type Row = { id: string; name: string; slug: string | null; priceInPaise: number; sortOrder: number; aliases: string[]; category: string; emoji: string };
type BulkBody = { data: { created: Row[]; updated: Row[]; skipped: { name: string; reason: string }[] } };

describe.skipIf(!ENABLED)("POST /api/menu/bulk — DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let bulkRoute: typeof import("@/app/api/menu/bulk/route");
  let menuRoute: typeof import("@/app/api/menu/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("menu-bulk.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    bulkRoute = await import("@/app/api/menu/bulk/route");
    menuRoute = await import("@/app/api/menu/route");
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.$disconnect();
  });

  async function seedVendor() {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `menubulk-${tag}`,
        name: `Menu Bulk ${tag}`,
        ownerName: "Test Owner",
        plan: "FREE",
        menuItems: {
          create: [
            { name: "Samosa", slug: "samosa", priceInPaise: 2_000, category: "Snacks", sortOrder: 0 },
            { name: "Masala Chai", slug: "masala-chai", priceInPaise: 1_500, category: "Chai", sortOrder: 3 },
          ],
        },
      },
      include: { menuItems: true },
    });
    vendorIds.push(v.id);
    return v;
  }

  function req(path: string, body: unknown) {
    return new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates and updates in one call, skipping another vendor's id", async () => {
    const mine = await seedVendor();
    const other = await seedVendor();
    const samosa = mine.menuItems.find((m) => m.name === "Samosa")!;
    const chai = mine.menuItems.find((m) => m.name === "Masala Chai")!;
    const otherSamosa = other.menuItems.find((m) => m.name === "Samosa")!;
    auth.vendor = mine;

    const res = await bulkRoute.POST(
      req("/api/menu/bulk", {
        items: [
          { name: "Samosa", priceInPaise: 2_500, category: "Snacks", emoji: "🥟", aliases: [], existingMenuItemId: samosa.id },
          // A draft row posted as-is (extra keys are ignored).
          {
            key: "new:mango lassi",
            action: "create",
            priceSpoken: true,
            name: "Mango Lassi",
            priceInPaise: 6_000,
            category: "Drinks",
            emoji: "🥛",
            aliases: ["aam lassi"],
            existingMenuItemId: null,
          },
          { name: "Cutting Chai", priceInPaise: 1_000, category: "Chai", emoji: "☕", aliases: [] },
          { name: "Stolen", priceInPaise: 1, category: "Snacks", emoji: "🥟", aliases: [], existingMenuItemId: otherSamosa.id },
          { name: "Samosa again", priceInPaise: 9_900, existingMenuItemId: samosa.id },
          { name: "cutting  chai", priceInPaise: 1_200 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as BulkBody;

    expect(data.updated.map((r) => [r.id, r.priceInPaise])).toEqual([[samosa.id, 2_500]]);
    expect(data.created.map((r) => [r.name, r.slug, r.priceInPaise, r.category, r.emoji, r.sortOrder])).toEqual([
      ["Mango Lassi", "mango-lassi", 6_000, "Drinks", "🥛", 4],
      ["Cutting Chai", "cutting-chai", 1_000, "Chai", "☕", 5],
    ]);
    expect(data.created[0]!.aliases).toEqual(["mango lassi", "mango", "lassi", "aam lassi"]);
    expect(data.skipped).toEqual([
      { name: "Samosa again", reason: "duplicate" },
      { name: "cutting  chai", reason: "duplicate" },
      { name: "Stolen", reason: "not_found" },
    ]);

    // Other tenant untouched; only the price changed on mine.
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: otherSamosa.id } })).priceInPaise).toBe(2_000);
    const mineAfter = await prisma.menuItem.findUniqueOrThrow({ where: { id: samosa.id } });
    expect(mineAfter).toMatchObject({ name: "Samosa", slug: "samosa", category: "Snacks", priceInPaise: 2_500 });
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: chai.id } })).priceInPaise).toBe(1_500);
    expect(await prisma.menuItem.count({ where: { vendorId: other.id } })).toBe(2);
    expect(await prisma.menuItem.count({ where: { vendorId: mine.id } })).toBe(4);
  });

  it("dedupes slugs against existing rows and within the batch", async () => {
    const mine = await seedVendor();
    auth.vendor = mine;
    const res = await bulkRoute.POST(
      req("/api/menu/bulk", {
        items: [
          { name: "Samosa!", priceInPaise: 3_000 }, // slug "samosa" is taken; name differs
          { name: "Samosa?", priceInPaise: 3_500 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as BulkBody;
    expect(data.created.map((r) => [r.slug, r.category, r.emoji])).toEqual([
      ["samosa-2", "General", "🍽️"],
      ["samosa-3", "General", "🍽️"],
    ]);
  });

  it("an all-foreign batch saves nothing and still answers 201 with skips", async () => {
    const mine = await seedVendor();
    const other = await seedVendor();
    auth.vendor = mine;
    const res = await bulkRoute.POST(
      req("/api/menu/bulk", { items: [{ name: "X", priceInPaise: 100, existingMenuItemId: other.menuItems[0]!.id }] }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as BulkBody).data).toEqual({
      created: [],
      updated: [],
      skipped: [{ name: "X", reason: "not_found" }],
    });
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: other.menuItems[0]!.id } })).priceInPaise).not.toBe(100);
  });

  it("POST /api/menu is unchanged: slug dedupe, merged aliases, next sortOrder, defaults", async () => {
    const mine = await seedVendor();
    auth.vendor = mine;
    const res = await menuRoute.POST(
      req("/api/menu", { name: "Samosa", priceInRupees: 22.5, aliasesCsv: "smosa, samosa" }),
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Row & { isAvailable: boolean; showOnline: boolean; hsnCode: string | null } };
    expect(data).toMatchObject({
      name: "Samosa",
      slug: "samosa-2",
      priceInPaise: 2_250,
      sortOrder: 4,
      category: "General",
      emoji: "🍽️",
      isAvailable: true,
      showOnline: true,
      hsnCode: null,
    });
    expect(data.aliases).toEqual(["samosa", "smosa"]);
  });
});
