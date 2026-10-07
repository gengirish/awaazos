/**
 * "Keep at least one way to pay" — DB integration test for PATCH /api/vendor.
 * Runs only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never
 * production); see lib/__tests__/drops.db.test.ts for the docker / db push recipe.
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/payment-guard.db.test.ts
 *
 * Drives the real route handler with requireVendorRole mocked to "signed in as
 * <vendor>" (OWNER).
 */
import { randomBytes } from "node:crypto";

import type { DropStatus, Vendor } from "@prisma/client";
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

const HOUR = 3_600_000;

describe.skipIf(!ENABLED)("PATCH /api/vendor — last payment method guard, DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let vendorRoute: typeof import("@/app/api/vendor/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("payment-guard.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    vendorRoute = await import("@/app/api/vendor/route");
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }); // cascades the rest
    }
    await prisma.$disconnect();
  });

  async function seedVendor(opts: { upiId: string | null; acceptPayOnDelivery: boolean; acceptMenuOrders: boolean }) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `pay-guard-${tag}`,
        name: `Pay Guard ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        upiId: opts.upiId,
        settings: {
          create: {
            publishStorefront: true,
            acceptPayOnDelivery: opts.acceptPayOnDelivery,
            acceptMenuOrders: opts.acceptMenuOrders,
          },
        },
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  async function seedDrop(v: Vendor, status: DropStatus, opts: { opensAt?: Date; closesAt?: Date } = {}) {
    const now = Date.now();
    return prisma.drop.create({
      data: {
        vendorId: v.id,
        title: `Drop ${status}`,
        date: new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z"),
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now + 48 * HOUR),
        fulfilmentEndsAt: new Date(now + 49 * HOUR),
        opensAt: opts.opensAt ?? null,
        closesAt: opts.closesAt ?? new Date(now + 24 * HOUR),
        status,
      },
    });
  }

  function patchAs(v: Vendor, body: unknown) {
    auth.vendor = v;
    return vendorRoute.PATCH(
      new NextRequest("http://localhost/api/vendor", { method: "PATCH", body: JSON.stringify(body) }),
    );
  }

  const stored = (id: string) =>
    prisma.vendor.findUnique({
      where: { id },
      select: { upiId: true, settings: { select: { acceptPayOnDelivery: true, acceptMenuOrders: true } } },
    });

  it("clearing UPI with pay on delivery off and menu orders on → 409, nothing saved", async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: false, acceptMenuOrders: true });
    const res = await patchAs(v, { upiId: null, upiName: "New Name" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_payment_method", blockers: ["menu_orders"] });
    const after = await stored(v.id);
    expect(after?.upiId).toBe("stall@okaxis");
    // The whole request is refused, not just the payment field.
    expect((await prisma.vendor.findUnique({ where: { id: v.id } }))?.upiName).toBeNull();
  });

  it('clearing UPI with "" is treated the same as null', async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: false, acceptMenuOrders: true });
    const res = await patchAs(v, { upiId: "" });
    expect(res.status).toBe(409);
  });

  it("clearing UPI with menu orders off and no open drop → 200", async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: false, acceptMenuOrders: false });
    await seedDrop(v, "DRAFT");
    const res = await patchAs(v, { upiId: null });
    expect(res.status).toBe(200);
    expect((await stored(v.id))?.upiId).toBeNull();
  });

  it("clearing UPI while pay on delivery stays on → 200 even with menu orders on", async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: true, acceptMenuOrders: true });
    const res = await patchAs(v, { upiId: null });
    expect(res.status).toBe(200);
  });

  it("turning pay on delivery off with no UPI and an open drop → 409", async () => {
    const v = await seedVendor({ upiId: null, acceptPayOnDelivery: true, acceptMenuOrders: false });
    await seedDrop(v, "OPEN");
    const res = await patchAs(v, { acceptPayOnDelivery: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_payment_method", blockers: ["open_drop"] });
    expect((await stored(v.id))?.settings?.acceptPayOnDelivery).toBe(true);
  });

  it("a scheduled drop (OPEN, opensAt in the future) also blocks", async () => {
    const v = await seedVendor({ upiId: null, acceptPayOnDelivery: true, acceptMenuOrders: false });
    await seedDrop(v, "OPEN", { opensAt: new Date(Date.now() + 2 * HOUR), closesAt: new Date(Date.now() + 24 * HOUR) });
    const res = await patchAs(v, { acceptPayOnDelivery: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_payment_method", blockers: ["open_drop"] });
  });

  it("turning pay on delivery off with no UPI and only closed drops → 200", async () => {
    const v = await seedVendor({ upiId: null, acceptPayOnDelivery: true, acceptMenuOrders: false });
    await seedDrop(v, "CLOSED");
    await seedDrop(v, "OPEN", { closesAt: new Date(Date.now() - HOUR) }); // past cut-off = effectively CLOSED
    await seedDrop(v, "FROZEN");
    const res = await patchAs(v, { acceptPayOnDelivery: false });
    expect(res.status).toBe(200);
    expect((await stored(v.id))?.settings?.acceptPayOnDelivery).toBe(false);
  });

  it("turning both off in one request with menu orders on → 409 listing every blocker", async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: true, acceptMenuOrders: true });
    await seedDrop(v, "OPEN");
    const res = await patchAs(v, { upiId: null, acceptPayOnDelivery: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_payment_method", blockers: ["menu_orders", "open_drop"] });
    const after = await stored(v.id);
    expect(after?.upiId).toBe("stall@okaxis");
    expect(after?.settings?.acceptPayOnDelivery).toBe(true);
  });

  it("turning both off together with menu orders off (no drop) → 200", async () => {
    const v = await seedVendor({ upiId: "stall@okaxis", acceptPayOnDelivery: true, acceptMenuOrders: true });
    const res = await patchAs(v, { upiId: null, acceptPayOnDelivery: false, acceptMenuOrders: false });
    expect(res.status).toBe(200);
    const after = await stored(v.id);
    expect(after?.upiId).toBeNull();
    expect(after?.settings).toMatchObject({ acceptPayOnDelivery: false, acceptMenuOrders: false });
  });

  it("other vendors' open drops don't count", async () => {
    const other = await seedVendor({ upiId: "other@okaxis", acceptPayOnDelivery: true, acceptMenuOrders: true });
    await seedDrop(other, "OPEN");
    const v = await seedVendor({ upiId: null, acceptPayOnDelivery: true, acceptMenuOrders: false });
    const res = await patchAs(v, { acceptPayOnDelivery: false });
    expect(res.status).toBe(200);
  });

  it("requests that don't touch payment fields are not blocked, even with no method left", async () => {
    // Legacy state: no method while menu orders are on. Unrelated edits still save.
    const v = await seedVendor({ upiId: null, acceptPayOnDelivery: false, acceptMenuOrders: true });
    const res = await patchAs(v, { city: "Pune" });
    expect(res.status).toBe(200);
  });
});
