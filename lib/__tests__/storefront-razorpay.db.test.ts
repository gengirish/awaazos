/**
 * Storefront Razorpay routes — DB integration test. Runs only with
 * RAZORPAY_DB_TEST=1 against a THROWAWAY local Postgres (never production).
 * Razorpay itself is mocked (global fetch); signatures are produced with known
 * test secrets, exactly as Razorpay would.
 *
 *   docker run -d --name awaazos-drops -p 5434:5432 -e POSTGRES_USER=ci \
 *     -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=awaazos postgres:15-alpine
 *   DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
 *   RAZORPAY_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=... \
 *     npx vitest run lib/__tests__/storefront-razorpay.db.test.ts
 *
 * Route modules are imported lazily so a plain `npm test` can load and skip it.
 */
import crypto from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.RAZORPAY_DB_TEST === "1";

type PrismaModule = typeof import("@/lib/prisma");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const KEY_ID = "rzp_test_UnitTest1234";
const KEY_SECRET = "unit_test_key_secret_abc";
const WEBHOOK_SECRET = "unit_test_webhook_secret";
const hmac = (secret: string, data: string) => crypto.createHmac("sha256", secret).update(data).digest("hex");

describe.skipIf(!ENABLED)("storefront razorpay — DB integration", { timeout: 30_000 }, () => {
  let prisma: PrismaModule["prisma"];
  let startPayment: Handler;
  let verify: Handler;
  let webhook: Handler;
  const vendorIds: string[] = [];
  /** Razorpay orders the fake API knows about: id → amount (paise). */
  const rzOrders = new Map<string, { amount: number; status: string }>();
  let createCalls = 0;
  /** Refunds the fake API has made, by payment; what it was asked to do; and a refusal to give. */
  const refunds = new Map<string, { id: string; amount: number; status: string; receipt: string }[]>();
  const refundsOn = (paymentId: string) => refunds.get(paymentId) ?? [];
  let refundPosts: { paymentId: string; amount: number }[] = [];
  let refundRefusal: string | null = null;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("storefront-razorpay.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.PAYMENT_KEYS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.UPSTASH_REDIS_REST_URL; // rate limiter fails open without KV
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    ({ prisma } = await import("@/lib/prisma"));
    startPayment = (await import("@/app/api/s/[slug]/orders/[token]/razorpay/route")).POST as Handler;
    verify = (await import("@/app/api/s/[slug]/orders/[token]/razorpay/verify/route")).POST as Handler;
    webhook = (await import("@/app/api/webhooks/razorpay-orders/[vendorId]/route")).POST as Handler;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`) {
          return new Response("{}", { status: 401 });
        }
        const u = new URL(input);
        if (init?.method === "POST" && u.pathname === "/v1/orders") {
          createCalls++;
          const body = JSON.parse(String(init.body)) as { amount: number };
          const id = `order_${crypto.randomBytes(7).toString("hex")}`;
          rzOrders.set(id, { amount: body.amount, status: "created" });
          return Response.json({ id, amount: body.amount, amount_paid: 0, currency: "INR", status: "created" });
        }
        const listed = /^\/v1\/payments\/(pay_\w+)\/refunds$/.exec(u.pathname);
        if (listed) {
          const items = refundsOn(listed[1] ?? "");
          return Response.json({ entity: "collection", count: items.length, items });
        }
        const refunding = /^\/v1\/payments\/(pay_\w+)\/refund$/.exec(u.pathname);
        if (refunding && init?.method === "POST") {
          const paymentId = refunding[1] ?? "";
          const body = JSON.parse(String(init.body)) as { amount: number; receipt: string };
          refundPosts.push({ paymentId, amount: body.amount });
          if (refundRefusal) return Response.json({ error: { description: refundRefusal } }, { status: 400 });
          const rows = refundsOn(paymentId);
          if (rows.some((r) => r.receipt === body.receipt)) {
            return Response.json({ error: { description: "Duplicate receipt found for this refund request." } }, { status: 400 });
          }
          const row = { id: `rfnd_${crypto.randomBytes(7).toString("hex")}`, amount: body.amount, status: "pending", receipt: body.receipt };
          refunds.set(paymentId, [...rows, row]);
          return Response.json(row);
        }
        const m = /^\/v1\/orders\/(order_\w+)$/.exec(u.pathname);
        if (m) {
          const o = rzOrders.get(m[1] ?? "");
          if (!o) return new Response("{}", { status: 404 });
          return Response.json({ id: m[1], amount: o.amount, amount_paid: 0, currency: "INR", status: o.status });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    createCalls = 0;
    refundPosts = [];
    refundRefusal = null;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.dailySummary.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
    await prisma.$disconnect();
  });

  async function seed(opts: { plan?: "FREE" | "PRO"; minsAgo?: number; total?: number } = {}) {
    const { encryptSecret } = await import("@/lib/secret-box");
    const { keySecretAad, webhookSecretAad } = await import("@/lib/storefront-razorpay");
    const tag = crypto.randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `rzp-test-${tag}`,
        name: `Rzp Test ${tag}`,
        ownerName: "Test Owner",
        plan: opts.plan ?? "PRO",
        settings: { create: { publishStorefront: true } },
      },
    });
    vendorIds.push(vendor.id);
    await prisma.vendorSettings.update({
      where: { vendorId: vendor.id },
      data: {
        razorpayKeyId: KEY_ID,
        razorpayKeySecretEnc: encryptSecret(KEY_SECRET, keySecretAad(vendor.id)),
        razorpayWebhookSecretEnc: encryptSecret(WEBHOOK_SECRET, webhookSecretAad(vendor.id)),
      },
    });
    const total = opts.total ?? 24_550;
    const token = crypto.randomBytes(24).toString("base64url");
    const txn = await prisma.transaction.create({
      data: {
        vendorId: vendor.id,
        billNumber: `AWZ-TEST-${tag}`,
        subtotalPaise: total,
        totalPaise: total,
        paymentMethod: "UPI",
        paymentStatus: "PENDING",
        source: "STOREFRONT",
        fulfilmentStatus: "PLACED",
        fulfilmentType: "PICKUP",
        orderToken: token,
        customerName: "Meera",
        customerPhone: "+919876543210",
        createdAt: new Date(Date.now() - (opts.minsAgo ?? 1) * 60_000),
        orderItems: { create: [{ name: "Ragi laddu", priceInPaise: total, qty: 2, totalPaise: total }] },
      },
    });
    return { vendor, txn, slug: vendor.slug, token };
  }

  const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

  const summary = (vendorId: string) => prisma.dailySummary.findMany({ where: { vendorId } });

  it("start: creates a Razorpay order for exactly totalPaise, then reuses it", async () => {
    const s = await seed();
    const ctx = { params: Promise.resolve({ slug: s.slug, token: s.token }) };
    const r1 = await startPayment(post("http://t/x"), ctx);
    expect(r1.status).toBe(200);
    const d1 = ((await r1.json()) as { data: Record<string, unknown> }).data;
    expect(d1).toMatchObject({ keyId: KEY_ID, amountPaise: 24_550, currency: "INR", billNumber: s.txn.billNumber });
    expect(JSON.stringify(d1)).not.toContain(KEY_SECRET);
    expect(rzOrders.get(String(d1.razorpayOrderId))?.amount).toBe(24_550);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row.razorpayOrderId).toBe(d1.razorpayOrderId);

    const r2 = await startPayment(post("http://t/x"), ctx);
    const d2 = ((await r2.json()) as { data: Record<string, unknown> }).data;
    expect(d2.razorpayOrderId).toBe(d1.razorpayOrderId);
    expect(createCalls).toBe(1);
  });

  it("start: concurrent taps converge on one stored order id", async () => {
    const s = await seed();
    const ctx = { params: Promise.resolve({ slug: s.slug, token: s.token }) };
    const res = await Promise.all([1, 2, 3].map(() => startPayment(post("http://t/x"), ctx)));
    const ids = await Promise.all(res.map(async (r) => ((await r.json()) as { data: { razorpayOrderId: string } }).data.razorpayOrderId));
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    for (const id of ids) expect(id).toBe(row.razorpayOrderId);
  });

  it("start: refuses expired holds, FREE plan, unknown token", async () => {
    const expired = await seed({ minsAgo: 20 });
    const r1 = await startPayment(post("http://t/x"), { params: Promise.resolve({ slug: expired.slug, token: expired.token }) });
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ error: "order_expired" });

    const free = await seed({ plan: "FREE" });
    const r2 = await startPayment(post("http://t/x"), { params: Promise.resolve({ slug: free.slug, token: free.token }) });
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ error: "online_payment_unavailable" });

    const r3 = await startPayment(post("http://t/x"), {
      params: Promise.resolve({ slug: free.slug, token: crypto.randomBytes(24).toString("base64url") }),
    });
    expect(r3.status).toBe(404);
  });

  it("verify: rejects bad signature and foreign order id, then marks paid exactly once", async () => {
    const s = await seed();
    const ctx = { params: Promise.resolve({ slug: s.slug, token: s.token }) };
    const started = ((await (await startPayment(post("http://t/x"), ctx)).json()) as { data: { razorpayOrderId: string } }).data;
    const orderId = started.razorpayOrderId;
    const paymentId = "pay_TestPayment001";

    const bad = await verify(
      post("http://t/x", { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac("wrong", `${orderId}|${paymentId}`) }),
      ctx,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_signature" });

    // Validly signed by this vendor, but for a different Razorpay order.
    const other = "order_SomeOtherOrder1";
    const foreign = await verify(
      post("http://t/x", { razorpay_order_id: other, razorpay_payment_id: paymentId, razorpay_signature: hmac(KEY_SECRET, `${other}|${paymentId}`) }),
      ctx,
    );
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "order_mismatch" });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } })).paymentStatus).toBe("PENDING");
    expect(await summary(s.vendor.id)).toHaveLength(0);

    const good = { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) };
    const ok = await verify(post("http://t/x", good), ctx);
    expect(ok.status).toBe(200);
    const again = await verify(post("http://t/x", good), ctx);
    expect(again.status).toBe(200);

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row.paymentStatus).toBe("PAID");
    expect(row.razorpayPaymentId).toBe(paymentId);
    const sums = await summary(s.vendor.id);
    expect(sums).toHaveLength(1);
    expect(sums[0]).toMatchObject({ totalRevenuePaise: 24_550, totalTransactions: 1, totalItemsSold: 2 });
  });

  it("webhook: HMAC first, cross-checks amount + notes, idempotent with verify", async () => {
    const s = await seed();
    const orderId = `order_${crypto.randomBytes(7).toString("hex")}`;
    await prisma.transaction.update({ where: { id: s.txn.id }, data: { razorpayOrderId: orderId } });
    const ctx = { params: Promise.resolve({ vendorId: s.vendor.id }) };
    const event = (amount: number, ev = "payment.captured", txnId = s.txn.id) =>
      JSON.stringify({
        entity: "event",
        event: ev,
        payload: {
          payment: { entity: { id: "pay_WebhookPay01", order_id: orderId, amount, currency: "INR", status: "captured", notes: [] } },
          order: { entity: { id: orderId, amount, amount_paid: amount, currency: "INR", status: "paid", notes: { transactionId: txnId, vendorId: s.vendor.id } } },
        },
      });

    const body = event(24_550);
    const forged = await webhook(post("http://t/x", body, { "x-razorpay-signature": hmac("nope", body) }), ctx);
    expect(forged.status).toBe(400);
    const noSig = await webhook(post("http://t/x", body), ctx);
    expect(noSig.status).toBe(400);
    const unknownVendor = await webhook(
      post("http://t/x", body, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) }),
      { params: Promise.resolve({ vendorId: "cnonexistentvendor000000" }) },
    );
    expect(unknownVendor.status).toBe(400);

    const wrongAmount = event(100);
    const r1 = await webhook(post("http://t/x", wrongAmount, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, wrongAmount) }), ctx);
    expect(r1.status).toBe(200);
    const wrongNotes = event(24_550, "order.paid", "someOtherTxn");
    const r1b = await webhook(post("http://t/x", wrongNotes, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, wrongNotes) }), ctx);
    expect(r1b.status).toBe(200);
    const irrelevant = event(24_550, "refund.created");
    const r1c = await webhook(post("http://t/x", irrelevant, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, irrelevant) }), ctx);
    expect(r1c.status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } })).paymentStatus).toBe("PENDING");

    const r2 = await webhook(post("http://t/x", body, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) }), ctx);
    expect(r2.status).toBe(200);
    const orderPaid = event(24_550, "order.paid");
    const r3 = await webhook(post("http://t/x", orderPaid, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, orderPaid) }), ctx);
    expect(r3.status).toBe(200);

    // The buyer's browser arrives late with the Checkout callback: still 200, no double credit.
    const paymentId = "pay_WebhookPay01";
    const late = await verify(
      post("http://t/x", { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) }),
      { params: Promise.resolve({ slug: s.slug, token: s.token }) },
    );
    expect(late.status).toBe(200);

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row.paymentStatus).toBe("PAID");
    expect(row.razorpayPaymentId).toBe("pay_WebhookPay01");
    const sums = await summary(s.vendor.id);
    expect(sums).toHaveLength(1);
    expect(sums[0]).toMatchObject({ totalRevenuePaise: 24_550, totalTransactions: 1 });
  });

  it("webhook: another vendor's secret cannot mark this vendor's order paid", async () => {
    const victim = await seed();
    const orderId = `order_${crypto.randomBytes(7).toString("hex")}`;
    await prisma.transaction.update({ where: { id: victim.txn.id }, data: { razorpayOrderId: orderId } });
    const attacker = await seed();
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_Attack0001", order_id: orderId, amount: 24_550, currency: "INR" } } },
    });
    // Signed with the (shared test) secret but posted to the attacker's own vendor path:
    // the lookup is scoped by vendorId, so the victim's order is never matched.
    const r = await webhook(post("http://t/x", body, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) }), {
      params: Promise.resolve({ vendorId: attacker.vendor.id }),
    });
    expect(r.status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: victim.txn.id } })).paymentStatus).toBe("PENDING");
  });

  // ─── Payments that land where they shouldn't, and refunds ─────────

  /** A signed webhook delivery for one captured payment on this order. */
  async function capture(s: { vendor: { id: string }; txn: { id: string } }, paymentId: string, event = "payment.captured") {
    const orderId = `order_${s.txn.id.slice(-12)}`;
    await prisma.transaction.update({ where: { id: s.txn.id }, data: { razorpayOrderId: orderId } });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    const body = JSON.stringify({
      event,
      payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: row.totalPaise, currency: "INR" } } },
    });
    const r = await webhook(post("http://t/x", body, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) }), {
      params: Promise.resolve({ vendorId: s.vendor.id }),
    });
    expect(r.status).toBe(200);
    return prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
  }

  const scopeOf = (s: { vendor: { id: string }; txn: { id: string; dropId?: string | null } }) => ({
    id: s.txn.id,
    vendorId: s.vendor.id,
    source: "STOREFRONT" as const,
    dropId: s.txn.dropId ?? null,
  });

  /** The two steps a PATCH route runs for one action, as a MANAGER unless told otherwise. */
  async function act(
    s: Parameters<typeof scopeOf>[0],
    action: "cancel" | "refund_payment_issue" | "keep_payment_issue",
    opts: { refund?: "razorpay" | "manual"; role?: "CASHIER" | "MANAGER" | "OWNER"; scope?: ReturnType<typeof scopeOf> } = {},
  ) {
    const { prepareOrderMoney } = await import("@/lib/storefront-order-refund");
    const { applyStorefrontOrderAction } = await import("@/lib/storefront-order-actions");
    const scope = opts.scope ?? scopeOf(s);
    const money = await prepareOrderMoney({ scope, action, refund: opts.refund, canRefund: (opts.role ?? "MANAGER") !== "CASHIER" });
    return prisma.$transaction((tx) => applyStorefrontOrderAction(tx, { scope, action, dropStatus: null, ...money }));
  }

  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string; reason?: string }) => ({ status: e.status, code: e.code, reason: e.reason }),
    );

  it("paid after cancel: flags once, stays cancelled, credits nothing, refund clears it for good", async () => {
    const s = await seed();
    await prisma.transaction.update({ where: { id: s.txn.id }, data: { fulfilmentStatus: "CANCELLED" } });

    const flagged = await capture(s, "pay_AfterCancel01");
    expect(flagged).toMatchObject({
      fulfilmentStatus: "CANCELLED",
      paymentStatus: "PENDING",
      paymentIssue: "paid_after_cancel",
      paymentIssuePaymentId: "pay_AfterCancel01",
    });
    const firstAt = flagged.paymentIssueAt;
    expect(firstAt).not.toBeNull();

    // The same payment again, as the other event: nothing moves.
    const repeat = await capture(s, "pay_AfterCancel01", "order.paid");
    expect(repeat.paymentIssueAt).toEqual(firstAt);
    expect(await summary(s.vendor.id)).toHaveLength(0);

    const { ordersBoardWhere } = await import("@/lib/drops-board-server");
    const old = new Date(Date.now() + 30 * 86_400_000);
    expect(await prisma.transaction.count({ where: { ...ordersBoardWhere(s.vendor.id, old), id: s.txn.id } })).toBe(1);

    await act(s, "refund_payment_issue");
    expect(refundPosts).toEqual([{ paymentId: "pay_AfterCancel01", amount: 24_550 }]);
    const done = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(done).toMatchObject({ fulfilmentStatus: "CANCELLED", paymentStatus: "PENDING", paymentIssue: null });
    expect(done.razorpayRefundId).toMatch(/^rfnd_/);
    expect(await summary(s.vendor.id)).toHaveLength(0);

    // Razorpay retries after the answer: it must not come back.
    expect((await capture(s, "pay_AfterCancel01")).paymentIssue).toBeNull();
  });

  it("paid twice: flags a second payment only, and its refund leaves the sale alone", async () => {
    const s = await seed();
    const { markOrderPaid } = await import("@/lib/drops");
    // The seller saw a direct UPI payment and marked it paid by hand.
    await prisma.$transaction((tx) => markOrderPaid(tx, { vendorId: s.vendor.id, transactionId: s.txn.id }));
    const before = await summary(s.vendor.id);

    const flagged = await capture(s, "pay_SecondPayment1");
    expect(flagged).toMatchObject({ paymentIssue: "paid_twice", paymentStatus: "PAID", paymentIssuePaymentId: "pay_SecondPayment1" });

    await act(s, "refund_payment_issue");
    const done = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(done).toMatchObject({ paymentIssue: null, paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED" });
    expect((await summary(s.vendor.id))[0]?.totalRevenuePaise).toBe(before[0]?.totalRevenuePaise);
  });

  it("the same payment through verify and both webhook events is not paid twice", async () => {
    const s = await seed();
    const ctx = { params: Promise.resolve({ slug: s.slug, token: s.token }) };
    const started = ((await (await startPayment(post("http://t/x"), ctx)).json()) as { data: { razorpayOrderId: string } }).data;
    const orderId = started.razorpayOrderId;
    const paymentId = "pay_OnePayment0001";
    const signed = { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) };
    const results = await Promise.all([
      verify(post("http://t/x", signed), ctx),
      verify(post("http://t/x", signed), ctx),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    for (const event of ["payment.captured", "order.paid"]) {
      const body = JSON.stringify({
        event,
        payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 24_550, currency: "INR" } } },
      });
      await webhook(post("http://t/x", body, { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) }), {
        params: Promise.resolve({ vendorId: s.vendor.id }),
      });
    }
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row).toMatchObject({ paymentStatus: "PAID", paymentIssue: null, paymentIssuePaymentId: null });
    expect((await summary(s.vendor.id))[0]).toMatchObject({ totalRevenuePaise: 24_550, totalTransactions: 1 });
  });

  it("start: tells Checkout how long the hold has left", async () => {
    const s = await seed({ minsAgo: 5 });
    const r = await startPayment(post("http://t/x"), { params: Promise.resolve({ slug: s.slug, token: s.token }) });
    const { holdSecondsLeft } = ((await r.json()) as { data: { holdSecondsLeft: number } }).data;
    expect(holdSecondsLeft).toBeGreaterThan(590);
    expect(holdSecondsLeft).toBeLessThanOrEqual(600);
  });

  async function seedDrop(s: { vendor: { id: string }; txn: { id: string } }, maxQty: number | null) {
    const tag = crypto.randomBytes(4).toString("hex");
    const menuItem = await prisma.menuItem.create({
      data: { vendorId: s.vendor.id, name: `Laddu ${tag}`, slug: `laddu-${tag}`, priceInPaise: 24_550, category: "Sweets" },
    });
    const soon = new Date(Date.now() + 86_400_000);
    const drop = await prisma.drop.create({
      data: {
        vendorId: s.vendor.id,
        title: "Saturday bakes",
        date: soon,
        closesAt: soon,
        fulfilmentStartsAt: soon,
        fulfilmentEndsAt: soon,
        status: "OPEN",
        items: { create: [{ menuItemId: menuItem.id, priceInPaise: 24_550, maxQty }] },
      },
      include: { items: true },
    });
    const dropItem = drop.items[0]!;
    const attach = (id: string) =>
      prisma.$transaction(async (tx) => {
        await tx.transaction.update({ where: { id }, data: { dropId: drop.id } });
        await tx.orderItem.updateMany({ where: { transactionId: id }, data: { dropItemId: dropItem.id, qty: 1 } });
      });
    await attach(s.txn.id);
    return { attach };
  }

  it("late payment: flags a drop only when it really oversells, and keep or cancel answers it", async () => {
    const late = await seed({ minsAgo: 40 });
    const { attach } = await seedDrop(late, 1);
    // Another buyer took the last one once the hold had lapsed.
    const taken = await prisma.transaction.create({
      data: {
        vendorId: late.vendor.id,
        billNumber: `AWZ-TAKEN-${late.txn.id.slice(-6)}`,
        subtotalPaise: 100,
        totalPaise: 100,
        paymentMethod: "CASH",
        source: "STOREFRONT",
        fulfilmentStatus: "CONFIRMED",
        fulfilmentType: "PICKUP",
        orderToken: crypto.randomBytes(24).toString("base64url"),
        orderItems: { create: [{ name: "Ragi laddu", priceInPaise: 100, qty: 1, totalPaise: 100 }] },
      },
    });
    await attach(taken.id);

    const flagged = await capture(late, "pay_LatePayment001");
    expect(flagged).toMatchObject({ paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED", paymentIssue: "paid_late_oversold" });
    const withDrop = { ...late, txn: { ...late.txn, dropId: flagged.dropId } };

    await act(withDrop, "keep_payment_issue");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: late.txn.id } }))).toMatchObject({ paymentIssue: null, paymentStatus: "PAID" });
    // Answered is answered, whichever event comes next.
    expect((await capture(late, "pay_LatePayment001", "order.paid")).paymentIssue).toBeNull();

    // Room left on the drop: late, but nobody is short.
    const roomy = await seed({ minsAgo: 40 });
    await seedDrop(roomy, 5);
    expect(await capture(roomy, "pay_LateRoomy00001")).toMatchObject({ paymentStatus: "PAID", paymentIssue: null });

    // A menu order has no stock to oversell.
    const menu = await seed({ minsAgo: 40 });
    expect(await capture(menu, "pay_LateMenu000001")).toMatchObject({ paymentStatus: "PAID", paymentIssue: null });
  });

  it("cancelling a late oversold order refunds it and answers the issue", async () => {
    const late = await seed({ minsAgo: 40 });
    await seedDrop(late, 0);
    const row = await capture(late, "pay_LateCancel0001");
    expect(row.paymentIssue).toBe("paid_late_oversold");
    await act({ ...late, txn: { ...late.txn, dropId: row.dropId } }, "cancel");
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: late.txn.id } })).toMatchObject({
      fulfilmentStatus: "CANCELLED",
      paymentStatus: "REFUNDED",
      paymentIssue: null,
    });
    expect(refundPosts).toHaveLength(1);
    expect((await summary(late.vendor.id))[0]).toMatchObject({ totalRevenuePaise: 0 });
  });

  it("cancel and refund: reverses revenue once, and two phones refund once", async () => {
    const s = await seed();
    await capture(s, "pay_CancelRefund01");
    expect((await summary(s.vendor.id))[0]?.totalRevenuePaise).toBe(24_550);

    const results = await Promise.all([failure(act(s, "cancel")), failure(act(s, "cancel"))]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.find((r) => r !== null)).toMatchObject({ status: 409 });

    expect(refundsOn("pay_CancelRefund01")).toHaveLength(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row).toMatchObject({ fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED" });
    expect(row.razorpayRefundId).toBe(refundsOn("pay_CancelRefund01")[0]?.id);
    expect((await summary(s.vendor.id))[0]?.totalRevenuePaise).toBe(0);
  });

  it("a refused refund leaves the order paid and live; cancelling anyway is the seller's call", async () => {
    const s = await seed();
    await capture(s, "pay_LowBalance0001");
    refundRefusal = "Your account does not have enough balance to carry out the refund operation.";

    expect(await failure(act(s, "cancel"))).toEqual({ status: 409, code: "refund_failed", reason: "insufficient_balance" });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } })).toMatchObject({
      fulfilmentStatus: "CONFIRMED",
      paymentStatus: "PAID",
      razorpayRefundId: null,
    });
    expect((await summary(s.vendor.id))[0]?.totalRevenuePaise).toBe(24_550);

    await act(s, "cancel", { refund: "manual" });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } });
    expect(row).toMatchObject({ fulfilmentStatus: "CANCELLED", paymentStatus: "REFUNDED", razorpayRefundId: null });
    expect((await summary(s.vendor.id))[0]?.totalRevenuePaise).toBe(0);
  });

  it("a payment landing between the refund check and the cancel doesn't read as refunded", async () => {
    const s = await seed();
    await capture(s, "pay_RaceCancel0001");
    const { applyStorefrontOrderAction } = await import("@/lib/storefront-order-actions");
    const attempt = prisma.$transaction((tx) => applyStorefrontOrderAction(tx, { scope: scopeOf(s), action: "cancel", dropStatus: null }));
    expect(await failure(attempt)).toMatchObject({ status: 409, code: "invalid_state" });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: s.txn.id } })).paymentStatus).toBe("PAID");
  });

  it("a cashier can't send money back, and another store's order is a 404 first", async () => {
    const s = await seed();
    await capture(s, "pay_Cashier0000001");
    expect(await failure(act(s, "cancel", { role: "CASHIER" }))).toMatchObject({ status: 403, code: "manager_required" });
    expect(await failure(act(s, "cancel", { role: "CASHIER", refund: "manual" }))).toMatchObject({ status: 403 });
    expect(refundPosts).toHaveLength(0);

    const other = await seed();
    const foreign = { ...scopeOf(s), vendorId: other.vendor.id };
    for (const action of ["cancel", "refund_payment_issue", "keep_payment_issue"] as const) {
      expect(await failure(act(s, action, { role: "CASHIER", scope: foreign }))).toMatchObject({ status: 404 });
    }
    expect(refundPosts).toHaveLength(0);

    // A cashier still cancels an order with no Razorpay payment, as before.
    const unpaid = await seed();
    await act(unpaid, "cancel", { role: "CASHIER" });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: unpaid.txn.id } })).fulfilmentStatus).toBe("CANCELLED");
  });

  it("an issue never reaches the buyer's lookup", async () => {
    const { findStorefrontOrderForPayment } = await import("@/lib/storefront-razorpay");
    const s = await seed();
    const row = await findStorefrontOrderForPayment(s.slug, s.token);
    expect(Object.keys(row ?? {})).not.toEqual(expect.arrayContaining(["paymentIssue"]));
    expect(Object.keys(row ?? {})).not.toEqual(expect.arrayContaining(["razorpayRefundId"]));
    expect(Object.keys(row ?? {})).not.toEqual(expect.arrayContaining(["paymentIssuePaymentId"]));
  });
});
