/**
 * Admin outreach GUI — DB integration test. Runs only with DROPS_DB_TEST=1
 * against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 *
 * Calls the route handlers directly: /api/admin/demo-stores (+ /{ref},
 * /{ref}/handover), /api/admin/admins/**, and the public /api/admin-invite
 * (+ /accept). Every write is real; only the session is stubbed.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => {
  // Rate limiters must stay local (fail-open) — never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  /** The signed-in caller, or null when signed out. */
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

describe.skipIf(!ENABLED)("admin outreach GUI — DB integration", () => {
  let prisma: PrismaClient;
  let stores: typeof import("@/app/api/admin/demo-stores/route");
  let store: typeof import("@/app/api/admin/demo-stores/[externalRef]/route");
  let handover: typeof import("@/app/api/admin/demo-stores/[externalRef]/handover/route");
  let invites: typeof import("@/app/api/admin/admins/invites/route");
  let invite: typeof import("@/app/api/admin/admins/invites/[id]/route");
  let admin: typeof import("@/app/api/admin/admins/[userId]/route");
  let redeem: typeof import("@/app/api/admin-invite/route");
  let accept: typeof import("@/app/api/admin-invite/accept/route");
  let superAdmin: { id: string; role: "SUPER_ADMIN" };
  const emails: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("admin-outreach.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    process.env.DEMO_OWNER_EMAIL = `demo-owner-${TAG}@example.test`;
    process.env.AUTH_URL = BASE;
    emails.push(process.env.DEMO_OWNER_EMAIL);
    ({ prisma } = await import("@/lib/prisma"));
    stores = await import("@/app/api/admin/demo-stores/route");
    store = await import("@/app/api/admin/demo-stores/[externalRef]/route");
    handover = await import("@/app/api/admin/demo-stores/[externalRef]/handover/route");
    invites = await import("@/app/api/admin/admins/invites/route");
    invite = await import("@/app/api/admin/admins/invites/[id]/route");
    admin = await import("@/app/api/admin/admins/[userId]/route");
    redeem = await import("@/app/api/admin-invite/route");
    accept = await import("@/app/api/admin-invite/accept/route");

    const email = `super-${TAG}@example.test`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: "Super", role: "SUPER_ADMIN" } });
    superAdmin = { id: u.id, role: "SUPER_ADMIN" };
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
    await prisma.adminInvite.deleteMany({ where: { email: { in: emails } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.user = superAdmin;
  });

  const json = (body: unknown, method = "POST") =>
    new Request(`${BASE}/api/x`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
  const none = ctx({} as Record<string, never>);
  const ref = (s: string) => `t${TAG}-${s}`;
  const tokenOf = (url: string, marker: string) => url.split(marker)[1]!;

  function payload(externalRef: string) {
    return {
      external_ref: externalRef,
      profile: { name: `Admin GUI ${TAG}`, category: "home_bakery", area: "Sahakar Nagar, Bengaluru" },
      items: [{ name: "Theme Cake", price_paise: 220_000 }],
      sample_orders: [
        { customer_name: "Meghana", customer_phone: "919999900001", lines: [{ item: "Theme Cake", qty: 1 }] },
      ],
    };
  }

  async function makeUser(role: "USER" | "SALES" | "ADMIN") {
    const email = `${role.toLowerCase()}-${randomBytes(3).toString("hex")}-${TAG}@example.test`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: role, role } });
    return { id: u.id, email, role };
  }

  it("404s every admin route for a signed-out caller and for a plain USER", async () => {
    for (const who of [null, { id: "u", role: "USER" as const }]) {
      h.user = who;
      expect((await stores.POST(json(payload(ref("nope"))), none)).status).toBe(404);
      expect((await store.DELETE(json({}, "DELETE"), ctx({ externalRef: ref("nope") }))).status).toBe(404);
      expect((await invites.POST(json({ email: "x@example.test" }), none)).status).toBe(404);
    }
    expect(await prisma.vendor.count({ where: { demoExternalRef: ref("nope") } })).toBe(0);
  });

  it("an ADMIN builds, hands over and deletes demo stores; audit rows name the admin", async () => {
    const a = await makeUser("ADMIN");
    h.user = { id: a.id, role: "ADMIN" };

    const created = await stores.POST(json(payload(ref("one"))), none);
    expect(created.status).toBe(201);
    const again = await stores.POST(json(payload(ref("one"))), none);
    expect(again.status).toBe(200);

    const link = await handover.POST(json({ owner_email: "Prospect@Example.test" }), ctx({ externalRef: ref("one") }));
    expect(link.status).toBe(201);
    expect(((await link.json()) as { data: { claim_url: string } }).data.claim_url).toContain("/claim/");

    expect((await store.DELETE(json({}, "DELETE"), ctx({ externalRef: ref("one") }))).status).toBe(200);
    // Nothing is removed: the page's delete is soft, so it can be undone.
    expect(await prisma.vendor.count({ where: { demoExternalRef: ref("one"), isActive: false } })).toBe(1);
    const audit = await prisma.demoAuditLog.findMany({ where: { externalRef: ref("one") }, select: { action: true, actor: true } });
    expect(audit.map((r) => r.action).sort()).toEqual(["create", "delete", "handover"]);
    expect(new Set(audit.map((r) => r.actor))).toEqual(new Set([`admin:${a.id}`]));
  });

  it("a SALES user reaches only the stores they built, can't delete, and no ADMIN route", async () => {
    const a = await makeUser("SALES");
    const b = await makeUser("SALES");
    const scope = await import("@/lib/sales-scope");
    const pipeline = await import("@/lib/admin-demo-stores");
    const earnings = await import("@/lib/sales-earnings-server");

    h.user = { id: a.id, role: "SALES" };
    expect((await stores.POST(json(payload(ref("mine"))), none)).status).toBe(201);
    expect((await stores.POST(json(payload(ref("mine"))), none)).status).toBe(200);
    expect((await store.DELETE(json({}, "DELETE"), ctx({ externalRef: ref("mine") }))).status).toBe(404);
    expect((await invites.POST(json({ email: "x@example.test" }), none)).status).toBe(404);
    expect((await handover.POST(json({ owner_email: "p@example.test" }), ctx({ externalRef: ref("mine") }))).status).toBe(201);

    // Another intern: the store looks missing, and the lead can't be rebuilt.
    h.user = { id: b.id, role: "SALES" };
    const taken = await stores.POST(json(payload(ref("mine"))), none);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: "lead_taken" });
    expect((await handover.POST(json({ owner_email: "p@example.test" }), ctx({ externalRef: ref("mine") }))).status).toBe(404);

    const mine = await prisma.vendor.findUniqueOrThrow({ where: { demoExternalRef: ref("mine") }, select: { id: true } });
    expect(await scope.demoVendorIdsBuiltBy(`admin:${a.id}`)).toEqual([mine.id]);
    expect(await scope.demoVendorIdsBuiltBy(`admin:${b.id}`)).toEqual([]);
    expect(await pipeline.listDemoPipeline([])).toEqual([]);

    // An ADMIN isn't scoped: the same store still hands over.
    const boss = await makeUser("ADMIN");
    h.user = { id: boss.id, role: "ADMIN" };
    expect((await handover.POST(json({ owner_email: "p@example.test" }), ctx({ externalRef: ref("mine") }))).status).toBe(201);

    // Earnings: the webhook's charge and a repeat of it pay once; a ₹0 event pays nothing.
    const event = (id: string, paymentId: string, amountPaise: number) => ({
      vendorId: mine.id,
      razorpayEventId: `${TAG}-${id}`,
      event: "subscription.charged",
      subscriptionId: `sub_${TAG}`,
      paymentId,
      amountPaise,
      status: "active",
    });
    await prisma.subscriptionEvent.createMany({
      data: [event("a", "pay_1", 35_282), event("b", "pay_1", 35_282), event("c", "pay_0", 0)],
    });
    const [own] = await earnings.loadSalesEarnings(a.id);
    expect(own).toMatchObject({ storesBuilt: 1, totalSharePaise: 14_950 });
    expect(await earnings.loadSalesEarnings(b.id)).toEqual([]);
    const everyone = await earnings.loadSalesEarnings();
    expect(everyone.find((r) => r.userId === a.id)?.totalSharePaise).toBe(14_950);

    // A removed intern is still owed: they drop to USER and stay on the report.
    h.user = superAdmin;
    expect((await admin.DELETE(json({}, "DELETE"), ctx({ userId: a.id }))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id }, select: { role: true } })).role).toBe("USER");
    expect((await earnings.loadSalesEarnings()).some((r) => r.userId === a.id)).toBe(true);

    await prisma.subscriptionEvent.deleteMany({ where: { razorpayEventId: { startsWith: `${TAG}-` } } });
  });

  it("an invite grants the role it was made for, and never demotes", async () => {
    const email = `sales-new-${TAG}@example.test`;
    emails.push(email);
    const res = await invites.POST(json({ email, role: "SALES" }), none);
    expect(res.status).toBe(201);
    const url = ((await res.json()) as { data: { invite_url: string } }).data.invite_url;
    h.user = null;
    const ok = await redeem.POST(
      json({ token: tokenOf(url, "/admin-invite/"), name: "Intern", password: "Outreach-2026!" }) as never,
    );
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email }, select: { role: true } })).role).toBe("SALES");

    // A SALES invite for an ADMIN is refused; an ADMIN invite for a SALES user is a promotion.
    h.user = superAdmin;
    const boss = await makeUser("ADMIN");
    expect((await invites.POST(json({ email: boss.email, role: "SALES" }), none)).status).toBe(409);
    expect((await invites.POST(json({ email, role: "SALES" }), none)).status).toBe(409);
    expect((await invites.POST(json({ email, role: "ADMIN" }), none)).status).toBe(201);
    expect((await invites.POST(json({ email, role: "SUPER_ADMIN" }), none)).status).toBe(400);
  });

  it("refuses payment details by name", async () => {
    const body = payload(ref("upi")) as Record<string, unknown>;
    (body.profile as Record<string, unknown>).upi_id = "seller@okaxis";
    const res = await stores.POST(json(body), none);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "payment_details_not_allowed" });
  });

  it("an ADMIN can't manage admins", async () => {
    const a = await makeUser("ADMIN");
    h.user = { id: a.id, role: "ADMIN" };
    expect((await invites.POST(json({ email: "x@example.test" }), none)).status).toBe(404);
    expect((await admin.DELETE(json({}, "DELETE"), ctx({ userId: superAdmin.id }))).status).toBe(404);
  });

  it("an invite for a new email creates the account as ADMIN, once", async () => {
    const email = `new-${TAG}@example.test`;
    emails.push(email);
    const res = await invites.POST(json({ email: email.toUpperCase() }), none);
    expect(res.status).toBe(201);
    const url = ((await res.json()) as { data: { invite_url: string } }).data.invite_url;
    const token = tokenOf(url, "/admin-invite/");
    const stored = await prisma.adminInvite.findFirst({ where: { email }, select: { tokenHash: true } });
    expect(stored?.tokenHash).not.toBe(token);

    h.user = null;
    const weak = await redeem.POST(json({ token, name: "New Admin", password: "short" }) as never);
    expect(weak.status).toBe(400);
    const ok = await redeem.POST(json({ token, name: "New Admin", password: "Outreach-2026!" }) as never);
    expect(ok.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { role: true, passwordHash: true } });
    expect(user.role).toBe("ADMIN");
    expect(user.passwordHash).toBeTruthy();

    const twice = await redeem.POST(json({ token, name: "New Admin", password: "Outreach-2026!" }) as never);
    expect(twice.status).toBe(400);
  });

  it("an existing account accepts only its own invite, and a new invite voids the old one", async () => {
    const u = await makeUser("USER");
    const first = (await (await invites.POST(json({ email: u.email }), none)).json()) as { data: { invite_url: string } };
    const second = (await (await invites.POST(json({ email: u.email }), none)).json()) as { data: { invite_url: string } };
    const oldToken = tokenOf(first.data.invite_url, "/admin-invite/");
    const token = tokenOf(second.data.invite_url, "/admin-invite/");

    // Someone else signed in: answers like a dead link, burns nothing.
    const other = await makeUser("USER");
    h.user = { id: other.id, role: "USER" };
    expect((await accept.POST(json({ token }) as never)).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("USER");

    // Creating an account for an email that has one is refused.
    h.user = null;
    expect((await redeem.POST(json({ token, name: "X", password: "Outreach-2026!" }) as never)).status).toBe(409);

    h.user = { id: u.id, role: "USER" };
    expect((await accept.POST(json({ token: oldToken }) as never)).status).toBe(400);
    expect((await accept.POST(json({ token }) as never)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("ADMIN");
  });

  it("refuses to invite someone who is already an admin; voids and removes", async () => {
    const a = await makeUser("ADMIN");
    const dup = await invites.POST(json({ email: a.email }), none);
    expect(dup.status).toBe(409);

    const u = await makeUser("USER");
    const made = (await (await invites.POST(json({ email: u.email }), none)).json()) as { data: { id: string } };
    expect((await invite.DELETE(json({}, "DELETE"), ctx({ id: made.data.id }))).status).toBe(200);
    expect((await invite.DELETE(json({}, "DELETE"), ctx({ id: made.data.id }))).status).toBe(404);

    expect((await admin.DELETE(json({}, "DELETE"), ctx({ userId: a.id }))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).role).toBe("USER");
    // Never a SUPER_ADMIN, never yourself.
    expect((await admin.DELETE(json({}, "DELETE"), ctx({ userId: superAdmin.id }))).status).toBe(409);
    const other = await prisma.user.create({
      data: { email: `super2-${TAG}@example.test`, role: "SUPER_ADMIN" },
    });
    emails.push(other.email);
    expect((await admin.DELETE(json({}, "DELETE"), ctx({ userId: other.id }))).status).toBe(404);
  });
});
