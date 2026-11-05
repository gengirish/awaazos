/**
 * Outreach pipeline — DB integration test. Runs only with DROPS_DB_TEST=1 against
 * a THROWAWAY Postgres (never production); see lib/__tests__/drops.db.test.ts for
 * the recipe, or `npm run test:drops:db`.
 *
 * Calls the route handlers directly. Every write is real; only the session is stubbed.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return { user: null as null | { id: string; role: "USER" | "SALES" | "ADMIN" | "SUPER_ADMIN" } };
});

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const RANK = { USER: 0, SALES: 1, ADMIN: 2, SUPER_ADMIN: 3 };
  return {
    AuthError,
    requirePlatformRole: vi.fn(async (required: keyof typeof RANK) => {
      if (!h.user) throw new AuthError(401, "Unauthorized");
      if (RANK[h.user.role] < RANK[required]) throw new AuthError(403, "Forbidden");
      return { user: h.user };
    }),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (h.user ? { user: { id: h.user.id } } : null)),
}));

const TAG = randomBytes(4).toString("hex");
const BASE = "http://localhost:3000";

describe.skipIf(!ENABLED)("demo pipeline — DB integration", () => {
  let prisma: PrismaClient;
  let stores: typeof import("@/app/api/admin/demo-stores/route");
  let store: typeof import("@/app/api/admin/demo-stores/[externalRef]/route");
  let handover: typeof import("@/app/api/admin/demo-stores/[externalRef]/handover/route");
  let pipeline: typeof import("@/app/api/admin/demo-stores/[externalRef]/pipeline/route");
  let bulk: typeof import("@/app/api/admin/demo-stores/pipeline/bulk/route");
  let server: typeof import("@/lib/demo-pipeline-server");
  let rules: typeof import("@/lib/demo-pipeline");
  let demo: typeof import("@/lib/demo-store");
  let admin: { id: string; role: "ADMIN" };
  const emails: string[] = [];

  const ref = (name: string) => `t${TAG}-${name}`;
  const json = (body: unknown, method = "POST") =>
    new Request(`${BASE}/x`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ctx = (externalRef: string) => ({ params: Promise.resolve({ externalRef }) });
  const none = { params: Promise.resolve({} as Record<string, never>) };
  const act = (name: string, body: unknown) => pipeline.POST(json(body), ctx(ref(name)));
  const eventId = async (res: Response) => ((await res.json()) as { data: { event_id: string } }).data.event_id;

  async function build(name: string, contact_name?: string) {
    const res = await stores.POST(
      json({
        external_ref: ref(name),
        ...(contact_name ? { contact_name } : {}),
        profile: { name: `Store ${name}`, area: "Hubli" },
        items: [{ name: "Cake", price_paise: 50000 }],
        sample_orders: [
          { customer_name: "Sample", customer_phone: "+919999900001", lines: [{ item: "Cake", qty: 1 }] },
        ],
      }),
      none,
    );
    expect(res.status).toBe(201);
    return prisma.vendor.findUniqueOrThrow({ where: { demoExternalRef: ref(name) }, select: { id: true, slug: true } });
  }

  async function item(name: string) {
    const items = await server.loadPipelineItems();
    return items.find((i) => i.ref === ref(name));
  }

  async function makeUser(role: "SALES" | "ADMIN") {
    const email = `${role.toLowerCase()}-${randomBytes(3).toString("hex")}-${TAG}@example.test`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: role, role } });
    return { id: u.id, role };
  }

  /** A real order: not a sample, so the store counts as "orders waiting". */
  async function placeRealOrder(vendorId: string, billNumber: string) {
    await prisma.transaction.create({
      data: {
        vendorId,
        billNumber,
        subtotalPaise: 50000,
        totalPaise: 50000,
        paymentMethod: "CASH",
        paymentStatus: "PENDING",
        source: "STOREFRONT",
        fulfilmentType: "PICKUP",
        fulfilmentStatus: "PLACED",
        orderToken: randomBytes(24).toString("base64url"),
      },
    });
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("demo-pipeline.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    process.env.DEMO_OWNER_EMAIL = `demo-owner-${TAG}@example.test`;
    process.env.AUTH_URL = BASE;
    emails.push(process.env.DEMO_OWNER_EMAIL);
    ({ prisma } = await import("@/lib/prisma"));
    stores = await import("@/app/api/admin/demo-stores/route");
    store = await import("@/app/api/admin/demo-stores/[externalRef]/route");
    handover = await import("@/app/api/admin/demo-stores/[externalRef]/handover/route");
    pipeline = await import("@/app/api/admin/demo-stores/[externalRef]/pipeline/route");
    bulk = await import("@/app/api/admin/demo-stores/pipeline/bulk/route");
    server = await import("@/lib/demo-pipeline-server");
    rules = await import("@/lib/demo-pipeline");
    demo = await import("@/lib/demo-store");
    admin = (await makeUser("ADMIN")) as { id: string; role: "ADMIN" };
  });

  afterAll(async () => {
    if (!prisma) return;
    const vendors = await prisma.vendor.findMany({
      where: { demoExternalRef: { startsWith: `t${TAG}-` } },
      select: { id: true },
    });
    const ids = vendors.map((v) => v.id);
    await prisma.receipt.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    await prisma.demoAuditLog.deleteMany({ where: { externalRef: { startsWith: `t${TAG}-` } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.user = admin;
  });

  it("a bulk send of 3 leaves 3 stores invite_sent with 3 events, and the tile goes up", async () => {
    for (const n of ["bulk-a", "bulk-b", "bulk-c"]) await build(n);
    for (const n of ["bulk-a", "bulk-b", "bulk-c"]) {
      expect((await act(n, { action: "sent" })).status).toBe(200);
      const it_ = await item(n);
      expect(rules.pipelineState(it_!.facts).status).toBe("invite_sent");
      expect(rules.pipelineTile(rules.pipelineState(it_!.facts).status)).toBe("sent");
    }
    const events = await prisma.demoAuditLog.findMany({
      where: { action: "invite_sent", externalRef: { in: ["bulk-a", "bulk-b", "bulk-c"].map(ref) } },
    });
    expect(events).toHaveLength(3);
  });

  it("a second send is a nudge, and Undo puts it back", async () => {
    await build("nudge");
    await act("nudge", { action: "sent" });
    const nudged = await act("nudge", { action: "sent" });
    let row = await item("nudge");
    expect(row!.facts.nudgeCount).toBe(1);
    expect((await act("nudge", { action: "undo", event_id: await eventId(nudged) })).status).toBe(200);
    row = await item("nudge");
    expect(row!.facts.nudgeCount).toBe(0);
    expect(row!.facts.lastNudgeAt).toBeNull();
    expect(row!.facts.inviteSentAt).not.toBeNull();
  });

  it("soft delete takes the store off the page and stops its claim link; undo restores both", async () => {
    await build("del");
    const link = await handover.POST(json({ owner_email: "seller@example.test" }), ctx(ref("del")));
    const claimUrl = ((await link.json()) as { data: { claim_url: string } }).data.claim_url;
    const token = claimUrl.split("/claim/")[1]!;
    expect(await demo.loadClaim(token)).not.toBeNull();

    const res = await store.DELETE(json({}, "DELETE"), ctx(ref("del")));
    expect(res.status).toBe(200);
    const { event_id } = (await res.json()) as { event_id: string };

    expect(await prisma.vendor.findUnique({ where: { demoExternalRef: ref("del") }, select: { isActive: true } })).toEqual({
      isActive: false,
    });
    expect(await item("del")).toBeUndefined();
    expect(await demo.loadClaim(token)).toBeNull();
    await expect(
      demo.claimDemoStore({ token, name: "Seller", password: "Correct-Horse-9-Battery", sampleOrders: "archive" }),
    ).rejects.toMatchObject({ code: "invalid_or_expired" });
    // Nothing else may act on it, and rebuilding the ref doesn't pretend it exists.
    expect((await act("del", { action: "snooze" })).status).toBe(404);
    expect((await handover.POST(json({ owner_email: "a@example.test" }), ctx(ref("del")))).status).toBe(404);

    expect((await act("del", { action: "undo", event_id })).status).toBe(200);
    expect(await prisma.vendor.findUnique({ where: { demoExternalRef: ref("del") }, select: { isActive: true } })).toEqual({
      isActive: true,
    });
    expect(await item("del")).toBeDefined();
    expect(await demo.loadClaim(token)).not.toBeNull();
    expect(await prisma.vendor.count({ where: { demoExternalRef: ref("del") } })).toBe(1);
  });

  it("rebuilding a soft-deleted ref is refused", async () => {
    await build("rebuild");
    await store.DELETE(json({}, "DELETE"), ctx(ref("rebuild")));
    const again = await stores.POST(
      json({ external_ref: ref("rebuild"), profile: { name: "Again" }, items: [{ name: "Cake", price_paise: 100 }] }),
      none,
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "ref_deleted" });
  });

  it("undo works only for the newest action, and only for whoever made it", async () => {
    await build("undo");
    const first = await eventId(await act("undo", { action: "snooze" }));
    const second = await eventId(await act("undo", { action: "archive" }));
    expect((await act("undo", { action: "undo", event_id: first })).status).toBe(409);
    h.user = await makeUser("ADMIN");
    expect((await act("undo", { action: "undo", event_id: second })).status).toBe(409);
    h.user = admin;
    expect((await act("undo", { action: "undo", event_id: second })).status).toBe(200);
    expect((await act("undo", { action: "undo", event_id: second })).status).toBe(409);
  });

  it("archive and restore move a store out of and back into the queue", async () => {
    await build("arch");
    let row = await item("arch");
    expect(rules.priorityScore(row!.facts)).not.toBeNull();
    await act("arch", { action: "archive", reason: "test" });
    row = await item("arch");
    expect(rules.pipelineState(row!.facts)).toMatchObject({ status: "archived", archivedReason: "test" });
    expect(rules.priorityScore(row!.facts)).toBeNull();
    await act("arch", { action: "restore" });
    row = await item("arch");
    expect(rules.pipelineState(row!.facts).status).toBe("built");
  });

  it("only real orders count, and a duplicate with real orders can't be the one archived", async () => {
    const v = await build("orders");
    let row = await item("orders");
    // The build's sample order doesn't count.
    expect(row!.facts.orderCount).toBe(0);
    await placeRealOrder(v.id, `AWZ-${TAG}-1`);
    row = await item("orders");
    expect(row!.facts.orderCount).toBe(1);
    expect(rules.isOrdersWaiting(row!.facts)).toBe(true);

    const dup = await act("orders", { action: "archive", reason: "duplicate" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "has_real_orders" });
    expect((await act("orders", { action: "archive", reason: "manual" })).status).toBe(200);
  });

  it("a claim link needs a saved email, then comes from the normal handover and voids the last one", async () => {
    await build("claim", "Lahari");
    expect((await item("claim"))!.contactName).toBe("Lahari");
    const missing = await act("claim", { action: "claim_link" });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "email_required" });

    expect((await act("claim", { action: "contact", contact_email: "Seller@Example.test" })).status).toBe(200);
    expect((await item("claim"))!.contactEmail).toBe("seller@example.test");

    const mint = async () => {
      const res = await act("claim", { action: "claim_link" });
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { claim_url: string } }).data.claim_url.split("/claim/")[1]!;
    };
    const one = await mint();
    expect((await demo.loadClaim(one))?.email).toBe("seller@example.test");
    const two = await mint();
    expect(await demo.loadClaim(one)).toBeNull();
    expect(await demo.loadClaim(two)).not.toBeNull();

    // The audit payload never carries contact details.
    const rows = await prisma.demoAuditLog.findMany({ where: { externalRef: ref("claim") } });
    expect(JSON.stringify(rows)).not.toContain("seller@example.test");
    expect(JSON.stringify(rows)).not.toContain("Lahari");
  });

  it("a claim stops the follow-ups, and the claim flow itself is unchanged", async () => {
    await build("claimed");
    await act("claimed", { action: "contact", contact_email: `owner-${TAG}@example.test` });
    emails.push(`owner-${TAG}@example.test`);
    await act("claimed", { action: "sent" });
    const res = await act("claimed", { action: "claim_link" });
    const token = ((await res.json()) as { data: { claim_url: string } }).data.claim_url.split("/claim/")[1]!;
    await demo.claimDemoStore({ token, name: "Owner", password: "Correct-Horse-9-Battery", sampleOrders: "archive" });

    const row = await item("claimed");
    expect(rules.pipelineState(row!.facts)).toMatchObject({ status: "claimed", followUpDue: null });
    expect((await act("claimed", { action: "archive" })).status).toBe(409);
    expect((await store.DELETE(json({}, "DELETE"), ctx(ref("claimed")))).status).toBe(409);
    // A claimed store can still be nudged, and that is never a first invite.
    const nudged = await act("claimed", { action: "sent" });
    expect(nudged.status).toBe(200);
    expect(
      await prisma.demoAuditLog.count({ where: { externalRef: ref("claimed"), action: "nudge_sent" } }),
    ).toBe(1);
  });

  it("a SALES user acts only on stores they built, and bulk archive reports the rest", async () => {
    const seller = await makeUser("SALES");
    await build("theirs");
    h.user = seller;
    await build("mine");
    expect((await act("theirs", { action: "sent" })).status).toBe(404);
    expect((await act("mine", { action: "sent" })).status).toBe(200);
    expect((await store.DELETE(json({}, "DELETE"), ctx(ref("mine")))).status).toBe(404);

    const res = await bulk.POST(json({ refs: [ref("mine"), ref("theirs"), ref("nobody")], action: "archive" }), none);
    const body = (await res.json()) as { data: { succeeded: { ref: string }[]; failed: { ref: string; error: string }[] } };
    expect(body.data.succeeded.map((s) => s.ref)).toEqual([ref("mine")]);
    expect(body.data.failed).toEqual([
      { ref: ref("theirs"), error: "not_found" },
      { ref: ref("nobody"), error: "not_found" },
    ]);
  });

  it("anyone below SALES gets 404", async () => {
    h.user = null;
    expect((await act("mine", { action: "sent" })).status).toBe(404);
    expect((await bulk.POST(json({ refs: [ref("mine")], action: "archive" }), none)).status).toBe(404);
  });
});
