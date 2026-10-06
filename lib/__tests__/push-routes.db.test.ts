/**
 * /api/push/* route handlers — DB integration test. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 *
 * Handlers are called directly with requireVendorRole mocked to "signed in as
 * <user> at <vendor>". web-push sendNotification is mocked; VAPID validation
 * is real with a pair generated per run.
 */
import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addSubscription, clearVapidEnv, fakeEndpoint, fakeKeys, seedPushVendor, setFakeVapidEnv } from "./push-db-helpers";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => {
  // Rate limiters must stay local (fail-open) — never reach a real Upstash.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return { auth: null as null | { user: { id: string }; vendor: { id: string } }, send: vi.fn() };
});

vi.mock("web-push", async (importOriginal) => {
  const mod = await importOriginal<{ default?: Record<string, unknown> } & Record<string, unknown>>();
  const real = (mod.default ?? mod) as Record<string, unknown>;
  return { default: { ...real, sendNotification: h.send } };
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
  return {
    AuthError,
    requireVendorRole: vi.fn(async () => {
      if (!h.auth) throw new AuthError(401, "Unauthorized");
      return { user: h.auth.user, vendor: h.auth.vendor, staff: { role: "CASHIER" }, setVendorCookie: null };
    }),
  };
});

type Seeded = Awaited<ReturnType<typeof seedPushVendor>>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe.skipIf(!ENABLED)("/api/push routes — DB integration", () => {
  let prisma: PrismaClient;
  let push: typeof import("@/lib/push");
  let subsRoute: typeof import("@/app/api/push/subscriptions/route");
  let subRoute: typeof import("@/app/api/push/subscriptions/[id]/route");
  let testRoute: typeof import("@/app/api/push/test/route");
  let generateKeys: () => { publicKey: string; privateKey: string };
  const vendorIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("push-routes.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    push = await import("@/lib/push");
    subsRoute = await import("@/app/api/push/subscriptions/route");
    subRoute = await import("@/app/api/push/subscriptions/[id]/route");
    testRoute = await import("@/app/api/push/test/route");
    generateKeys = (await import("web-push")).default.generateVAPIDKeys;
  });

  afterAll(async () => {
    clearVapidEnv();
    push?.__resetPushConfigForTest();
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    setFakeVapidEnv(generateKeys);
    push.__resetPushConfigForTest();
    h.send.mockReset();
    h.send.mockResolvedValue({ statusCode: 201 });
    h.auth = null;
  });

  async function seed(): Promise<Seeded> {
    const s = await seedPushVendor(prisma);
    vendorIds.push(s.vendor.id);
    userIds.push(...s.userIds);
    return s;
  }

  const signIn = (userId: string, vendorId: string) => {
    h.auth = { user: { id: userId }, vendor: { id: vendorId } };
  };

  const base = "http://localhost/api/push";
  const post = (body: unknown) =>
    subsRoute.POST(
      new NextRequest(`${base}/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const get = () => subsRoute.GET(new NextRequest(`${base}/subscriptions`));
  const delById = (id: string) =>
    subRoute.DELETE(new NextRequest(`${base}/subscriptions/${id}`, { method: "DELETE" }), { params: { id } });
  const delByEndpoint = (endpoint: string) =>
    subsRoute.DELETE(
      new NextRequest(`${base}/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: "DELETE" }),
    );
  const sendTest = () => testRoute.POST(new NextRequest(`${base}/test`, { method: "POST" }));

  it("401 when signed out", async () => {
    expect((await get()).status).toBe(401);
  });

  it("503 push_not_configured on subscribe and test when VAPID env is missing", async () => {
    const s = await seed();
    signIn(s.owner.id, s.vendor.id);
    clearVapidEnv();
    push.__resetPushConfigForTest();

    const r1 = await post({ endpoint: fakeEndpoint(), keys: fakeKeys() });
    expect(r1.status).toBe(503);
    expect(await r1.json()).toEqual({ error: "push_not_configured" });
    const r2 = await sendTest();
    expect(r2.status).toBe(503);
    expect(h.send).not.toHaveBeenCalled();

    const list = await (await get()).json();
    expect(list.meta.configured).toBe(false);
  });

  it("POST creates a subscription for the current user + vendor", async () => {
    const s = await seed();
    signIn(s.cashier.id, s.vendor.id);
    const endpoint = fakeEndpoint();
    const res = await post({ endpoint, keys: fakeKeys(), label: "Chrome on Android" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(Object.keys(data)).toEqual(["id"]);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row).toMatchObject({ id: data.id, userId: s.cashier.id, vendorId: s.vendor.id, label: "Chrome on Android" });
  });

  it("POST of a known endpoint refreshes keys/label and resets failures; another account takes it over", async () => {
    const s = await seed();
    const other = await seed();
    signIn(s.owner.id, s.vendor.id);
    const endpoint = fakeEndpoint();
    const first = await (await post({ endpoint, keys: fakeKeys(), label: "Old" })).json();
    await prisma.pushSubscription.update({ where: { id: first.data.id }, data: { failureCount: 3 } });

    const keys = fakeKeys();
    const again = await post({ endpoint, keys, label: "New" });
    expect(again.status).toBe(201);
    expect((await again.json()).data.id).toBe(first.data.id);
    let row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row).toMatchObject({ p256dh: keys.p256dh, auth: keys.auth, label: "New", failureCount: 0 });

    // Same phone, different account at a different stall.
    signIn(other.cashier.id, other.vendor.id);
    expect((await post({ endpoint, keys: fakeKeys() })).status).toBe(201);
    row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row).toMatchObject({ userId: other.cashier.id, vendorId: other.vendor.id, label: null });
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
  });

  it("caps at 10 devices per user per vendor (409), but re-registering an existing one still works", async () => {
    const s = await seed();
    signIn(s.owner.id, s.vendor.id);
    const subs = [];
    for (let i = 0; i < 10; i++) subs.push(await addSubscription(prisma, s.vendor.id, s.owner.id));

    const res = await post({ endpoint: fakeEndpoint(), keys: fakeKeys() });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("too_many_devices");

    expect((await post({ endpoint: subs[0]!.endpoint, keys: fakeKeys() })).status).toBe(201);
    expect(await prisma.pushSubscription.count({ where: { vendorId: s.vendor.id, userId: s.owner.id } })).toBe(10);

    // Another staff member at the same stall is not affected by the owner's cap.
    signIn(s.cashier.id, s.vendor.id);
    expect((await post({ endpoint: fakeEndpoint(), keys: fakeKeys() })).status).toBe(201);
  });

  it("POST rejects non-https endpoints and malformed keys without echoing them", async () => {
    const s = await seed();
    signIn(s.owner.id, s.vendor.id);
    const bad = [
      { endpoint: "http://push.example.com/abc", keys: fakeKeys() },
      { endpoint: "not a url", keys: fakeKeys() },
      { endpoint: `https://x.example/${"a".repeat(2050)}`, keys: fakeKeys() },
      { endpoint: fakeEndpoint(), keys: { p256dh: "short", auth: fakeKeys().auth } },
      { endpoint: fakeEndpoint(), keys: { p256dh: fakeKeys().p256dh, auth: "has spaces and !!!!!!" } },
      { endpoint: fakeEndpoint(), keys: fakeKeys(), label: "x".repeat(61) },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text).error).toBe("Invalid input");
      expect(text).not.toContain(body.keys.p256dh);
    }
  });

  it("GET returns only the current user's rows for the active vendor, hashed, never endpoint or keys", async () => {
    const s = await seed();
    const other = await seed();
    const mine = await addSubscription(prisma, s.vendor.id, s.cashier.id, { label: "My phone" });
    await addSubscription(prisma, s.vendor.id, s.owner.id);
    await addSubscription(prisma, s.vendor.id, s.former.id); // inactive staff: not counted
    await addSubscription(prisma, other.vendor.id, s.cashier.id); // same user, other stall (stale row)

    signIn(s.cashier.id, s.vendor.id);
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.data).toEqual([
      {
        id: mine.id,
        label: "My phone",
        createdAt: mine.createdAt.toISOString(),
        lastSuccessAt: null,
        endpointHash: sha256(mine.endpoint),
      },
    ]);
    expect(json.meta).toEqual({ configured: true, vendorDeviceCount: 2 });
    expect(text).not.toContain(mine.endpoint);
    expect(text).not.toContain(mine.p256dh);
    expect(text).not.toContain(mine.auth);
    expect(text).not.toMatch(/"endpoint"|"p256dh"|"auth"/);
  });

  it("DELETE by id: another user's or another vendor's row is a 404 and stays; own row is removed", async () => {
    const s = await seed();
    const other = await seed();
    const ownerSub = await addSubscription(prisma, s.vendor.id, s.owner.id);
    const otherVendorSub = await addSubscription(prisma, other.vendor.id, other.owner.id);
    const mine = await addSubscription(prisma, s.vendor.id, s.cashier.id);

    signIn(s.cashier.id, s.vendor.id);
    for (const id of [ownerSub.id, otherVendorSub.id, "does-not-exist"]) {
      const res = await delById(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
    expect(await prisma.pushSubscription.count({ where: { id: { in: [ownerSub.id, otherVendorSub.id] } } })).toBe(2);

    const ok = await delById(mine.id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ success: true });
    expect(await prisma.pushSubscription.findUnique({ where: { id: mine.id } })).toBeNull();
  });

  it("DELETE by endpoint removes only the caller's row and never reveals whether it existed", async () => {
    const s = await seed();
    const mine = await addSubscription(prisma, s.vendor.id, s.cashier.id);
    const theirs = await addSubscription(prisma, s.vendor.id, s.owner.id);

    signIn(s.cashier.id, s.vendor.id);
    for (const endpoint of [theirs.endpoint, fakeEndpoint(), mine.endpoint]) {
      const res = await delByEndpoint(endpoint);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    }
    expect(await prisma.pushSubscription.findUnique({ where: { id: mine.id } })).toBeNull();
    expect(await prisma.pushSubscription.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it("POST /api/push/test sends only to the caller's own devices", async () => {
    const s = await seed();
    const mine1 = await addSubscription(prisma, s.vendor.id, s.cashier.id);
    const mine2 = await addSubscription(prisma, s.vendor.id, s.cashier.id);
    await addSubscription(prisma, s.vendor.id, s.owner.id);

    signIn(s.cashier.id, s.vendor.id);
    const res = await sendTest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { sent: 2 } });
    const endpoints = h.send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(endpoints).toEqual([mine1.endpoint, mine2.endpoint].sort());
    expect(JSON.parse(h.send.mock.calls[0]![1] as string)).toEqual({
      title: "🔔 Test alert",
      body: "Alerts are working on this device.",
      url: "/orders",
      tag: "test",
    });
  });
});
