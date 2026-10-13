/**
 * Opening a drop on a private storefront — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the docker / db push recipe.
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/drop-open-publish.db.test.ts
 *
 * Drives the real PATCH /api/drops/[id]/status handler with requireVendorRole
 * mocked to "signed in as <vendor> with <role>".
 */
import { randomBytes } from "node:crypto";

import type { StaffRole, Vendor } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const auth = vi.hoisted(() => ({ vendor: null as unknown, role: "OWNER" as string }));

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
      return { user: {}, staff: { role: auth.role }, vendor: auth.vendor, setVendorCookie: null };
    }),
  };
});

type PrismaModule = typeof import("@/lib/prisma");

describe.skipIf(!ENABLED)("opening a drop on a private storefront — DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let statusRoute: typeof import("@/app/api/drops/[id]/status/route");
  const vendorIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("drop-open-publish.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    statusRoute = await import("@/app/api/drops/[id]/status/route");
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }); // cascades the rest
    await prisma.$disconnect();
  });

  /** A vendor with a private storefront and one DRAFT drop that is otherwise ready to open. */
  async function seed(opts: { acceptPayOnDelivery?: boolean; publishStorefront?: boolean } = {}) {
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `drop-publish-${tag}`,
        name: `Drop Publish ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        settings: {
          create: {
            publishStorefront: opts.publishStorefront ?? false,
            acceptPayOnDelivery: opts.acceptPayOnDelivery ?? true,
          },
        },
        menuItems: { create: [{ name: "Ragi laddu", priceInPaise: 12000 }] },
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
        fulfilmentMode: "PICKUP",
        fulfilmentStartsAt: new Date(now.getTime() + 2 * 86_400_000),
        fulfilmentEndsAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
        closesAt: new Date(now.getTime() + 86_400_000),
        status: "DRAFT",
        items: { create: [{ menuItemId: vendor.menuItems[0]!.id, priceInPaise: 12000, sortOrder: 0 }] },
      },
    });
    return { vendor, drop };
  }

  const as = (v: Vendor | null, role: StaffRole = "OWNER") => {
    auth.vendor = v;
    auth.role = role;
  };
  const patchStatus = (dropId: string, body: unknown) =>
    statusRoute.PATCH(
      new NextRequest(`http://localhost/api/drops/${dropId}/status`, { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: dropId }) },
    );
  const published = async (vendorId: string) =>
    (await prisma.vendorSettings.findUniqueOrThrow({ where: { vendorId } })).publishStorefront;
  const dropStatus = async (id: string) => (await prisma.drop.findUniqueOrThrow({ where: { id } })).status;

  it("opening never publishes the store unless the request asks for it", async () => {
    const { vendor, drop } = await seed();
    as(vendor);

    const res = await patchStatus(drop.id, { status: "OPEN" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "storefront_not_published" });
    expect(await published(vendor.id)).toBe(false);
    expect(await dropStatus(drop.id)).toBe("DRAFT");
  });

  it("an owner publishes the store and opens the drop in one request", async () => {
    const { vendor, drop } = await seed();
    as(vendor);

    const res = await patchStatus(drop.id, { status: "OPEN", publishStorefront: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe("OPEN");
    expect(await published(vendor.id)).toBe(true);
    expect(await dropStatus(drop.id)).toBe("OPEN");
  });

  it("a manager can't publish the store, with or without the flag", async () => {
    const { vendor, drop } = await seed();
    as(vendor, "MANAGER");

    const res = await patchStatus(drop.id, { status: "OPEN", publishStorefront: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(await published(vendor.id)).toBe(false);
    expect(await dropStatus(drop.id)).toBe("DRAFT");

    // Once the owner has published, a manager opens drops as before.
    await prisma.vendorSettings.update({ where: { vendorId: vendor.id }, data: { publishStorefront: true } });
    expect((await patchStatus(drop.id, { status: "OPEN", publishStorefront: true })).status).toBe(200);
    expect(await dropStatus(drop.id)).toBe("OPEN");
  });

  it("the store stays private when the drop can't open", async () => {
    // No UPI ID and no pay on delivery: buyers couldn't pay.
    const { vendor, drop } = await seed({ acceptPayOnDelivery: false });
    as(vendor);

    const noPay = await patchStatus(drop.id, { status: "OPEN", publishStorefront: true });
    expect(noPay.status).toBe(409);
    expect(await noPay.json()).toEqual({ error: "no_payment_method" });
    expect(await published(vendor.id)).toBe(false);

    // The flag belongs to OPEN only.
    expect((await patchStatus(drop.id, { status: "CLOSED", publishStorefront: true })).status).toBe(400);
    expect(await published(vendor.id)).toBe(false);
  });

  it("another vendor's drop is a 404 and publishes nothing", async () => {
    const a = await seed();
    const b = await seed();
    as(b.vendor);

    expect((await patchStatus(a.drop.id, { status: "OPEN", publishStorefront: true })).status).toBe(404);
    expect(await published(a.vendor.id)).toBe(false);
    expect(await published(b.vendor.id)).toBe(false);
    expect(await dropStatus(a.drop.id)).toBe("DRAFT");
  });
});
