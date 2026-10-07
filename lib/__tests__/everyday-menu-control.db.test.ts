/**
 * Everyday-menu controls, vendor side — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the docker / db push recipe.
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/everyday-menu-control.db.test.ts
 *
 * Drives the real route handlers with requireVendorRole mocked:
 * - Drop.showEverydayMenu persists on POST /api/drops and PUT /api/drops/[id],
 *   comes back from GET /api/drops/[id], and is copied by .../duplicate.
 * - MenuItem.showOnline persists on POST /api/menu and PATCH /api/menu/[id],
 *   comes back from GET /api/menu, and PATCH stays tenant-scoped (404).
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
      return { user: {}, staff: { role: "OWNER" }, vendor: auth.vendor, setVendorCookie: null };
    }),
  };
});

type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("everyday menu controls — vendor side, DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let dropsRoute: typeof import("@/app/api/drops/route");
  let dropRoute: typeof import("@/app/api/drops/[id]/route");
  let duplicateRoute: typeof import("@/app/api/drops/[id]/duplicate/route");
  let menuRoute: typeof import("@/app/api/menu/route");
  let menuItemRoute: typeof import("@/app/api/menu/[id]/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("everyday-menu-control.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    dropsRoute = await import("@/app/api/drops/route");
    dropRoute = await import("@/app/api/drops/[id]/route");
    duplicateRoute = await import("@/app/api/drops/[id]/duplicate/route");
    menuRoute = await import("@/app/api/menu/route");
    menuItemRoute = await import("@/app/api/menu/[id]/route");
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
        slug: `menuctl-${tag}`,
        name: `Menu Ctl ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        settings: { create: { publishStorefront: true, acceptMenuOrders: true } },
        menuItems: { create: [{ name: "Samosa", priceInPaise: 2000 }] },
      },
      include: { menuItems: true },
    });
    vendorIds.push(v.id);
    return v;
  }

  function req(method: string, path: string, body?: unknown) {
    return new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function dropBody(menuItemId: string, extra: Record<string, unknown> = {}) {
    return {
      title: "Saturday bakes",
      date: "2030-10-12",
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "20:00",
      closesAtDate: "2030-10-11",
      closesAtTime: "21:00",
      items: [{ menuItemId, priceInPaise: 5000 }],
      ...extra,
    };
  }

  it("drops: showEverydayMenu defaults off, persists on create/replace, is returned and duplicated", async () => {
    const v = await seedVendor();
    auth.vendor = v;
    const itemId = v.menuItems[0]!.id;

    // Create without the field → false.
    let res = await dropsRoute.POST(req("POST", "/api/drops", dropBody(itemId)));
    expect(res.status).toBe(201);
    const { data: plain } = (await res.json()) as { data: { id: string } };
    expect((await prisma.drop.findUniqueOrThrow({ where: { id: plain.id } })).showEverydayMenu).toBe(false);

    // Create with it on → true.
    res = await dropsRoute.POST(req("POST", "/api/drops", dropBody(itemId, { showEverydayMenu: true })));
    expect(res.status).toBe(201);
    const { data: on } = (await res.json()) as { data: { id: string } };
    expect((await prisma.drop.findUniqueOrThrow({ where: { id: on.id } })).showEverydayMenu).toBe(true);

    // GET returns it.
    res = await dropRoute.GET(req("GET", `/api/drops/${on.id}`), { params: Promise.resolve({ id: on.id }) });
    expect(((await res.json()) as { data: { showEverydayMenu: boolean } }).data.showEverydayMenu).toBe(true);

    // Full replace turns it off (and on again).
    res = await dropRoute.PUT(req("PUT", `/api/drops/${on.id}`, dropBody(itemId, { showEverydayMenu: false })), {
      params: Promise.resolve({ id: on.id }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { showEverydayMenu: boolean } }).data.showEverydayMenu).toBe(false);
    res = await dropRoute.PUT(req("PUT", `/api/drops/${on.id}`, dropBody(itemId, { showEverydayMenu: true })), {
      params: Promise.resolve({ id: on.id }),
    });
    expect(((await res.json()) as { data: { showEverydayMenu: boolean } }).data.showEverydayMenu).toBe(true);

    // Duplicate copies both values.
    for (const [id, expected] of [
      [on.id, true],
      [plain.id, false],
    ] as const) {
      res = await duplicateRoute.POST(req("POST", `/api/drops/${id}/duplicate`, { date: "2030-10-13" }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(201);
      const { data: copy } = (await res.json()) as { data: { id: string } };
      const row = await prisma.drop.findUniqueOrThrow({ where: { id: copy.id } });
      expect(row.showEverydayMenu).toBe(expected);
      expect(row.status).toBe("DRAFT");
    }
  });

  it("menu: showOnline defaults on, persists on create and PATCH, is listed, and stays tenant-scoped", async () => {
    const v = await seedVendor();
    const other = await seedVendor();
    auth.vendor = v;

    let res = await menuRoute.POST(req("POST", "/api/menu", { name: "Chai", priceInRupees: 15 }));
    expect(res.status).toBe(201);
    const { data: chai } = (await res.json()) as { data: { id: string; showOnline: boolean } };
    expect(chai.showOnline).toBe(true);

    res = await menuRoute.POST(req("POST", "/api/menu", { name: "Vada", priceInRupees: 20, showOnline: false }));
    const { data: vada } = (await res.json()) as { data: { id: string; showOnline: boolean } };
    expect(vada.showOnline).toBe(false);

    // The card's switch sends showOnline on its own.
    res = await menuItemRoute.PATCH(req("PATCH", `/api/menu/${chai.id}`, { showOnline: false }), {
      params: Promise.resolve({ id: chai.id }),
    });
    expect(res.status).toBe(200);
    const patched = await prisma.menuItem.findUniqueOrThrow({ where: { id: chai.id } });
    expect(patched.showOnline).toBe(false);
    expect(patched.isAvailable).toBe(true); // counter availability untouched

    res = await menuRoute.GET(req("GET", "/api/menu"));
    const { data: list } = (await res.json()) as { data: { id: string; showOnline: boolean }[] };
    expect(list.find((i) => i.id === chai.id)?.showOnline).toBe(false);
    expect(list.find((i) => i.id === v.menuItems[0]!.id)?.showOnline).toBe(true);

    // Another tenant can't flip it: 404, row unchanged.
    auth.vendor = other;
    res = await menuItemRoute.PATCH(req("PATCH", `/api/menu/${chai.id}`, { showOnline: true }), {
      params: Promise.resolve({ id: chai.id }),
    });
    expect(res.status).toBe(404);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: chai.id } })).showOnline).toBe(false);
  });
});
