/**
 * Internal demo-store API — DB integration test. Runs only with DROPS_DB_TEST=1
 * against a THROWAWAY Postgres (never production); recipe in
 * lib/__tests__/drops.db.test.ts, or `npm run test:drops:db`.
 *
 * Calls the route handlers directly: /api/internal/demo-stores (+ /{ref},
 * /{ref}/handover) and the public /api/demo-claim.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

vi.hoisted(() => {
  // Rate limiters must stay local (fail-open) — never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

const KEY = `test-internal-key-${"x".repeat(32)}`;
const TAG = randomBytes(4).toString("hex");
const BASE = "http://localhost:3000";

describe.skipIf(!ENABLED)("internal demo-store API — DB integration", () => {
  let prisma: PrismaClient;
  let collection: typeof import("@/app/api/internal/demo-stores/route");
  let item: typeof import("@/app/api/internal/demo-stores/[externalRef]/route");
  let handover: typeof import("@/app/api/internal/demo-stores/[externalRef]/handover/route");
  let claim: typeof import("@/app/api/demo-claim/route");
  let drops: typeof import("@/lib/drops");
  const emails: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("demo-stores.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.INTERNAL_API_KEY = KEY;
    process.env.DEMO_OWNER_EMAIL = `demo-owner-${TAG}@example.test`;
    process.env.AUTH_URL = BASE;
    emails.push(process.env.DEMO_OWNER_EMAIL);
    ({ prisma } = await import("@/lib/prisma"));
    collection = await import("@/app/api/internal/demo-stores/route");
    item = await import("@/app/api/internal/demo-stores/[externalRef]/route");
    handover = await import("@/app/api/internal/demo-stores/[externalRef]/handover/route");
    claim = await import("@/app/api/demo-claim/route");
    drops = await import("@/lib/drops");
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
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.demoAuditLog.deleteMany({ where: { externalRef: { startsWith: `t${TAG}-` } } });
    await prisma.$disconnect();
  });

  // ─── helpers ───────────────────────────────────────────────────────

  const ref = (name: string) => `t${TAG}-${name}`;

  function req(method: string, path: string, body?: unknown, key: string | null = KEY): Request {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key !== null) headers["x-internal-api-key"] = key;
    return new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const noParams = { params: Promise.resolve({} as Record<string, never>) };
  const refParams = (externalRef: string) => ({ params: Promise.resolve({ externalRef }) });

  function createBody(externalRef: string, orders = 3) {
    const names = ["Ananya", "Rohit", "Meera", "Kabir", "Sana", "Arjun", "Divya", "Farah"];
    return {
      external_ref: externalRef,
      profile: {
        name: "Prankie's Bakery",
        category: "home_bakery",
        area: "Kondapur, Hyderabad",
        instagram: "@prankiesbakery",
        display_phone: "+917396637770",
        languages: ["en", "hi", "te"],
      },
      items: [
        { name: "Chocolate Truffle Cake", unit: "kg", price_paise: 120000 },
        { name: "Bento Cake", unit: "piece", price_paise: 55000 },
      ],
      sample_orders: names.slice(0, orders).map((customer_name, i) => ({
        customer_name,
        customer_phone: `9199999000${String(i + 1).padStart(2, "0")}`,
        lines: [{ item: i % 2 ? "Bento Cake" : "Chocolate Truffle Cake", qty: 1 + (i % 2) }],
        event_date: "2026-10-18T18:00:00+05:30",
        advance_paid_paise: i === 0 ? 100000 : 0,
        status: (["confirmed", "placed", "delivered"] as const)[i % 3],
      })),
    };
  }

  async function create(externalRef: string, orders = 3) {
    const res = await collection.POST(req("POST", "/api/internal/demo-stores", createBody(externalRef, orders)), noParams);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function claimUrlFor(externalRef: string, email: string): Promise<string> {
    emails.push(email);
    const res = await handover.POST(
      req("POST", `/api/internal/demo-stores/${externalRef}/handover`, { owner_email: email }),
      refParams(externalRef),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { claim_url: string; expires_at: string } };
    return json.data.claim_url;
  }

  const tokenOf = (claimUrl: string) => claimUrl.split("/claim/")[1]!;

  async function redeem(token: string, sampleOrders: "archive" | "delete" = "archive") {
    const res = await claim.POST(
      req("POST", "/api/demo-claim", { token, name: "Prankie", password: "Cakes4Kondapur!", sampleOrders }, null) as never,
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  // ─── auth ──────────────────────────────────────────────────────────

  it("401 without the key or with a wrong one, on every endpoint, before touching anything", async () => {
    const r = ref("auth");
    for (const key of [null, "", "wrong-key-".padEnd(48, "z")]) {
      const calls = [
        collection.POST(req("POST", "/api/internal/demo-stores", createBody(r), key), noParams),
        item.GET(req("GET", `/api/internal/demo-stores/${r}`, undefined, key), refParams(r)),
        item.DELETE(req("DELETE", `/api/internal/demo-stores/${r}`, undefined, key), refParams(r)),
        handover.POST(
          req("POST", `/api/internal/demo-stores/${r}/handover`, { owner_email: "a@b.co" }, key),
          refParams(r),
        ),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    }
    expect(await prisma.vendor.count({ where: { demoExternalRef: r } })).toBe(0);
  });

  // ─── create ────────────────────────────────────────────────────────

  it("creates the store, items and sample orders, and returns slug + public URL", async () => {
    const r = ref("create");
    const { status, json } = await create(r, 8);
    expect(status).toBe(201);
    expect(json).toMatchObject({ created: true, owner_login_hint: null });
    expect(json.slug).toMatch(/^prankie-s-bakery-[a-z0-9]{4}$/);
    expect(json.public_url).toBe(`${BASE}/s/${json.slug}`);

    const v = await prisma.vendor.findUniqueOrThrow({
      where: { id: json.store_id as string },
      include: {
        settings: true,
        staff: { include: { user: { select: { email: true } } } },
        menuItems: { orderBy: { sortOrder: "asc" } },
        transactions: { include: { orderItems: true, receipt: true }, orderBy: { createdAt: "asc" } },
      },
    });
    expect(v).toMatchObject({ isDemo: true, name: "Prankie's Bakery", upiId: "demo@upi", city: "Kondapur, Hyderabad" });
    expect(v.trialEndsAt).toBeNull();
    expect(v.settings).toMatchObject({
      publishStorefront: true,
      acceptMenuOrders: true,
      instagramHandle: "prankiesbakery",
      whatsappNumber: "+917396637770",
      acceptWhatsappOrders: false,
      showWhatsappOnStore: false,
      voiceLang: "en-IN",
    });
    expect(v.staff).toHaveLength(1);
    expect(v.staff[0]).toMatchObject({ role: "OWNER", user: { email: process.env.DEMO_OWNER_EMAIL } });

    expect(v.menuItems.map((m) => [m.name, m.unit, m.priceInPaise])).toEqual([
      ["Chocolate Truffle Cake", "kg", 120000],
      ["Bento Cake", "piece", 55000],
    ]);

    expect(v.transactions).toHaveLength(8);
    const first = v.transactions[0]!;
    expect(first).toMatchObject({
      isSample: true,
      source: "STOREFRONT",
      customerName: "Ananya",
      customerPhone: "+919999900001",
      totalPaise: 120000,
      advancePaidPaise: 100000,
      paymentStatus: "PENDING",
      fulfilmentStatus: "CONFIRMED",
    });
    expect(first.fulfilAt?.toISOString()).toBe("2026-10-18T12:30:00.000Z");
    expect(first.orderItems).toHaveLength(1);
    expect(first.receipt?.publicToken).toBeTruthy();
    // Bill numbers rise with createdAt.
    const bills = v.transactions.map((t) => t.billNumber);
    expect([...bills].sort()).toEqual(bills);

    // Not revenue: no DailySummary, nothing billable.
    expect(await prisma.dailySummary.count({ where: { vendorId: v.id } })).toBe(0);
    expect(await drops.countBillableTxnThisMonth(prisma, v.id)).toBe(0);

    expect(await prisma.demoAuditLog.count({ where: { externalRef: r, action: "create" } })).toBe(1);
  });

  it("is idempotent on external_ref: the repeat returns the same store, created: false", async () => {
    const r = ref("idem");
    const a = await create(r);
    const b = await create(r);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ created: false, store_id: a.json.store_id, slug: a.json.slug });
    expect(await prisma.vendor.count({ where: { demoExternalRef: r } })).toBe(1);
    expect(await prisma.transaction.count({ where: { vendorId: a.json.store_id as string } })).toBe(3);
  });

  it("concurrent duplicates resolve to one store", async () => {
    const r = ref("race");
    const results = await Promise.all([create(r), create(r), create(r)]);
    expect(new Set(results.map((x) => x.json.store_id)).size).toBe(1);
    expect(results.filter((x) => x.json.created === true)).toHaveLength(1);
    expect(await prisma.vendor.count({ where: { demoExternalRef: r } })).toBe(1);
  });

  it.each([
    ["a real-looking customer phone", (b: ReturnType<typeof createBody>) => {
      b.sample_orders[0]!.customer_phone = "919876543210";
    }],
    ["a UPI id", (b: ReturnType<typeof createBody>) => {
      (b.profile as Record<string, unknown>).upi_id = "prankie@okaxis";
    }],
    ["bank details", (b: ReturnType<typeof createBody>) => {
      (b as Record<string, unknown>).bank = { ifsc: "HDFC0001234" };
    }],
    ["a negative price", (b: ReturnType<typeof createBody>) => {
      b.items[0]!.price_paise = -1;
    }],
    ["a float price", (b: ReturnType<typeof createBody>) => {
      b.items[0]!.price_paise = 1200.5;
    }],
    ["an unknown item in an order line", (b: ReturnType<typeof createBody>) => {
      b.sample_orders[0]!.lines[0]!.item = "Red Velvet";
    }],
  ])("400 and nothing written for %s", async (_label, mutate) => {
    const r = ref(`bad-${randomBytes(3).toString("hex")}`);
    const b = createBody(r);
    mutate(b);
    const res = await collection.POST(req("POST", "/api/internal/demo-stores", b), noParams);
    expect(res.status).toBe(400);
    expect(await prisma.vendor.count({ where: { demoExternalRef: r } })).toBe(0);
  });

  it("names the payment field it refused", async () => {
    const b = createBody(ref("upi"));
    (b.profile as Record<string, unknown>).upi_id = "prankie@okaxis";
    const res = await collection.POST(req("POST", "/api/internal/demo-stores", b), noParams);
    expect(await res.json()).toEqual({ error: "payment_details_not_allowed", field: "profile.upi_id" });
  });

  it("rate-limits creates to 20 per day per key (429)", async () => {
    const rateKey = `rate-test-${"r".repeat(40)}`;
    process.env.INTERNAL_API_KEY = rateKey;
    const { internalKeyId } = await import("@/lib/internal-auth");
    const actor = `key:${internalKeyId()}`;
    try {
      await prisma.demoAuditLog.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({ action: "create", externalRef: `rate-${i}`, actor })),
      });
      const res = await collection.POST(
        req("POST", "/api/internal/demo-stores", createBody(ref("rate")), rateKey),
        noParams,
      );
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "rate_limited" });
      expect(await prisma.vendor.count({ where: { demoExternalRef: ref("rate") } })).toBe(0);
    } finally {
      process.env.INTERNAL_API_KEY = KEY;
      await prisma.demoAuditLog.deleteMany({ where: { actor } });
    }
  });

  // ─── get ───────────────────────────────────────────────────────────

  it("GET returns the summary and public URL; unknown ref → 404", async () => {
    const r = ref("get");
    const { json: created } = await create(r);
    const res = await item.GET(req("GET", `/api/internal/demo-stores/${r}`), refParams(r));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toMatchObject({
      store_id: created.store_id,
      external_ref: r,
      slug: created.slug,
      public_url: created.public_url,
      is_demo: true,
      item_count: 2,
      sample_order_count: 3,
      pending_handover: null,
    });
    const missing = await item.GET(req("GET", `/api/internal/demo-stores/${ref("nope")}`), refParams(ref("nope")));
    expect(missing.status).toBe(404);
  });

  // ─── delete ────────────────────────────────────────────────────────

  it("DELETE removes a demo store with its items, orders and receipts", async () => {
    const r = ref("del");
    const { json } = await create(r);
    const id = json.store_id as string;
    const res = await item.DELETE(req("DELETE", `/api/internal/demo-stores/${r}`), refParams(r));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await prisma.vendor.count({ where: { id } })).toBe(0);
    expect(await prisma.menuItem.count({ where: { vendorId: id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { vendorId: id } })).toBe(0);
    expect(await prisma.receipt.count({ where: { vendorId: id } })).toBe(0);
    expect(await prisma.demoAuditLog.count({ where: { externalRef: r, action: "delete" } })).toBe(1);

    const again = await item.DELETE(req("DELETE", `/api/internal/demo-stores/${r}`), refParams(r));
    expect(again.status).toBe(404);
  });

  // ─── handover + claim ──────────────────────────────────────────────

  it("claim works once, transfers ownership, flips is_demo, archives samples; delete is then refused", async () => {
    const r = ref("claim");
    const { json } = await create(r);
    const id = json.store_id as string;
    const email = `owner-${TAG}@example.test`;
    const url = await claimUrlFor(r, email);
    expect(url).toMatch(new RegExp(`^${BASE}/claim/[A-Za-z0-9_-]{32}$`));
    // Pending invite only: no account yet, and the raw token is not stored.
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    const stored = await prisma.demoHandover.findFirstOrThrow({ where: { vendorId: id } });
    expect(stored.tokenHash).not.toContain(tokenOf(url));
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);

    const ok = await redeem(tokenOf(url));
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ data: { slug: json.slug } });

    const v = await prisma.vendor.findUniqueOrThrow({
      where: { id },
      include: { staff: { include: { user: { select: { email: true, passwordHash: true } } } } },
    });
    expect(v.isDemo).toBe(false);
    expect(v.upiId).toBeNull();
    expect(v.email).toBe(email);
    expect(v.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
    expect(v.staff).toHaveLength(1);
    expect(v.staff[0]!.role).toBe("OWNER");
    expect(v.staff[0]!.user.email).toBe(email);
    expect(v.staff[0]!.user.passwordHash).toBeTruthy();

    const samples = await prisma.transaction.findMany({ where: { vendorId: id } });
    expect(samples).toHaveLength(3);
    expect(samples.every((t) => t.archivedAt !== null)).toBe(true);

    // Second use fails the same way as a bad token.
    const twice = await redeem(tokenOf(url));
    expect(twice).toMatchObject({ status: 400, json: { error: "invalid_or_expired" } });

    const del = await item.DELETE(req("DELETE", `/api/internal/demo-stores/${r}`), refParams(r));
    expect(del.status).toBe(409);
    expect(await prisma.vendor.count({ where: { id } })).toBe(1);

    const again = await handover.POST(
      req("POST", `/api/internal/demo-stores/${r}/handover`, { owner_email: "x@example.test" }),
      refParams(r),
    );
    expect(again.status).toBe(409);
    expect(await prisma.demoAuditLog.count({ where: { externalRef: r, action: { in: ["handover", "claim"] } } })).toBe(2);
  });

  it("claim can delete the sample orders instead", async () => {
    const r = ref("claimdel");
    const { json } = await create(r);
    const url = await claimUrlFor(r, `owner2-${TAG}@example.test`);
    expect((await redeem(tokenOf(url), "delete")).status).toBe(200);
    expect(await prisma.transaction.count({ where: { vendorId: json.store_id as string } })).toBe(0);
  });

  it("an expired link fails and transfers nothing", async () => {
    const r = ref("expired");
    const { json } = await create(r);
    const url = await claimUrlFor(r, `owner3-${TAG}@example.test`);
    await prisma.demoHandover.updateMany({
      where: { vendorId: json.store_id as string },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await redeem(tokenOf(url))).toMatchObject({ status: 400, json: { error: "invalid_or_expired" } });
    const v = await prisma.vendor.findUniqueOrThrow({ where: { id: json.store_id as string } });
    expect(v.isDemo).toBe(true);
    expect(await prisma.user.count({ where: { email: `owner3-${TAG}@example.test` } })).toBe(0);
  });

  it("a new handover voids the previous link", async () => {
    const r = ref("reinvite");
    await create(r);
    const first = await claimUrlFor(r, `owner4-${TAG}@example.test`);
    const second = await claimUrlFor(r, `owner5-${TAG}@example.test`);
    expect((await redeem(tokenOf(first))).status).toBe(400);
    expect((await redeem(tokenOf(second))).status).toBe(200);
  });

  it("refuses to claim with an email that already has an account (409), link stays usable", async () => {
    const r = ref("taken");
    await create(r);
    const email = `taken-${TAG}@example.test`;
    await prisma.user.create({ data: { email } });
    const url = await claimUrlFor(r, email);
    expect(await redeem(tokenOf(url))).toMatchObject({ status: 409, json: { error: "email_in_use" } });
    expect(await prisma.demoHandover.count({ where: { tokenHash: { not: "" }, usedAt: null, email } })).toBe(1);
  });
});
