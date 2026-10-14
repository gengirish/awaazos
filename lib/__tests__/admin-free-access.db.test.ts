/**
 * PATCH /api/admin/vendors/[id]/free-access — DB integration test. Runs only
 * with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 *
 * Every write is real. Only the session (requirePlatformRole) is stubbed.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addMonthsYmd, istTodayYmd } from "@/lib/admin-free-access";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => ({
  /** null = signed out; otherwise the caller's platform role. */
  role: null as null | "USER" | "ADMIN" | "SUPER_ADMIN",
}));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const RANK = { USER: 0, ADMIN: 1, SUPER_ADMIN: 2 };
  return {
    AuthError,
    requirePlatformRole: vi.fn(async (required: keyof typeof RANK) => {
      if (!h.role) throw new AuthError(401, "Unauthorized");
      if (RANK[h.role] < RANK[required]) throw new AuthError(403, "Forbidden");
      return { user: { id: "admin-user-db-test", role: h.role } };
    }),
  };
});

describe.skipIf(!ENABLED)("admin free-access route — DB integration", () => {
  let prisma: PrismaClient;
  let route: typeof import("@/app/api/admin/vendors/[id]/free-access/route");
  let listAdminVendors: typeof import("@/lib/admin-vendors").listAdminVendors;
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("admin-free-access.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    ({ prisma } = await import("@/lib/prisma"));
    route = await import("@/app/api/admin/vendors/[id]/free-access/route");
    ({ listAdminVendors } = await import("@/lib/admin-vendors"));
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.role = "SUPER_ADMIN";
  });

  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
  const sixMonths = () => addMonthsYmd(istTodayYmd(), 6);

  async function seed(data: { trialEndsAt: Date | null; plan?: "FREE" | "STARTER"; planExpiresAt?: Date | null }) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `free-access-test-${tag}`,
        name: `Free Access Test ${tag}`,
        ownerName: "Test Owner",
        phone: "+919876543210",
        email: `owner-${tag}@example.com`,
        ...data,
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  function patch(vendorId: string, body: unknown) {
    return route.PATCH(
      new NextRequest(`http://localhost/api/admin/vendors/${vendorId}/free-access`, {
        method: "PATCH",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: vendorId }) },
    );
  }

  it("unlocks a locked store until 23:59 IST on the chosen day", async () => {
    const v = await seed({ trialEndsAt: inDays(-3) });
    const freeUntil = sixMonths();

    const res = await patch(v.id, { freeUntil });
    expect(res.status).toBe(200);

    const expected = new Date(`${freeUntil}T18:29:00.000Z`);
    expect((await res.json()).data).toEqual({ id: v.id, trialEndsAt: expected.toISOString() });
    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.trialEndsAt).toEqual(expected);
  });

  it("leaves plan and planExpiresAt alone", async () => {
    const paidUntil = inDays(20);
    const v = await seed({ trialEndsAt: inDays(-40), plan: "STARTER", planExpiresAt: paidUntil });

    expect((await patch(v.id, { freeUntil: sixMonths() })).status).toBe(200);

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.plan).toBe("STARTER");
    expect(row.planExpiresAt).toEqual(paidUntil);
  });

  it("404s, and writes nothing, for anyone below SUPER_ADMIN", async () => {
    const before = inDays(-3);
    const v = await seed({ trialEndsAt: before });

    for (const role of [null, "USER", "ADMIN"] as const) {
      h.role = role;
      const res = await patch(v.id, { freeUntil: sixMonths() });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.trialEndsAt).toEqual(before);
  });

  it("404s for an unknown vendor", async () => {
    const res = await patch("no-such-vendor", { freeUntil: sixMonths() });
    expect(res.status).toBe(404);
  });

  it("400s on a past, too-distant or malformed date and keeps the old one", async () => {
    const before = inDays(5);
    const v = await seed({ trialEndsAt: before });

    const past = await patch(v.id, { freeUntil: addMonthsYmd(istTodayYmd(), -1) });
    expect(past.status).toBe(400);
    expect((await past.json()).error).toBe("in_past");

    const far = await patch(v.id, { freeUntil: addMonthsYmd(istTodayYmd(), 25) });
    expect(far.status).toBe(400);
    expect((await far.json()).error).toBe("too_far");

    expect((await patch(v.id, { freeUntil: "2027-02-30" })).status).toBe(400);
    expect((await patch(v.id, { months: 6 })).status).toBe(400);
    expect((await patch(v.id, "not json")).status).toBe(400);

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.trialEndsAt).toEqual(before);
  });

  it("lists stores by name or slug without owner contact details", async () => {
    const v = await seed({ trialEndsAt: null });

    const bySlug = await listAdminVendors(v.slug.toUpperCase());
    expect(bySlug.map((r) => r.id)).toEqual([v.id]);
    expect(Object.keys(bySlug[0]).sort()).toEqual(
      ["createdAt", "id", "isActive", "isDemo", "name", "plan", "planExpiresAt", "slug", "trialEndsAt"].sort(),
    );

    expect((await listAdminVendors(v.name)).map((r) => r.id)).toEqual([v.id]);
    expect(await listAdminVendors(`nothing-${randomBytes(6).toString("hex")}`)).toEqual([]);
  });
});
