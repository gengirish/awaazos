/**
 * Offers — DB integration test. Runs only with DROPS_DB_TEST=1 against a
 * THROWAWAY local Postgres (never production). Same setup as
 * lib/__tests__/drops.db.test.ts and included in `npm run test:drops:db`, or:
 *
 *   DROPS_DB_TEST=1 AUTH_SECRET=dev-secret DATABASE_URL=postgresql://ci:ci@localhost:5434/awaazos?schema=public \
 *     npx vitest run lib/__tests__/offers.db.test.ts
 *
 * Covers what the pure tests in offers.test.ts cannot: the three write paths
 * store the server's price, a tampered body changes nothing, the Razorpay
 * amount is the stored total, and the receipt reconciles. Razorpay itself is
 * mocked (global fetch).
 */
import crypto from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

// The order route looks for a buyer session; outside a request there is no
// cookie store, so give it an empty one (guest checkout).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

type PrismaModule = typeof import("@/lib/prisma");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const KEY_ID = "rzp_test_OffersTest123";
const KEY_SECRET = "offers_test_key_secret";

describe.skipIf(!ENABLED)("offers — DB integration", () => {
  let prisma: PrismaModule["prisma"];
  let drops: typeof import("@/lib/drops");
  let posOffers: typeof import("@/lib/pos-offers");
  let receiptData: typeof import("@/lib/receipt-data");
  let placeMenuOrderRoute: Handler;
  let startPayment: Handler;
  const vendorIds: string[] = [];
  /** Amounts the fake Razorpay was asked to create orders for. */
  const rzAmounts: number[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("offers.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.PAYMENT_KEYS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.UPSTASH_REDIS_REST_URL; // rate limiter and idempotency fail open without KV
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    ({ prisma } = await import("@/lib/prisma"));
    drops = await import("@/lib/drops");
    posOffers = await import("@/lib/pos-offers");
    receiptData = await import("@/lib/receipt-data");
    placeMenuOrderRoute = (await import("@/app/api/s/[slug]/menu-orders/route")).POST as Handler;
    startPayment = (await import("@/app/api/s/[slug]/orders/[token]/razorpay/route")).POST as Handler;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const u = new URL(input);
        if (init?.method === "POST" && u.pathname === "/v1/orders") {
          const body = JSON.parse(String(init.body)) as { amount: number };
          rzAmounts.push(body.amount);
          const id = `order_${crypto.randomBytes(7).toString("hex")}`;
          return Response.json({ id, amount: body.amount, amount_paid: 0, currency: "INR", status: "created" });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!prisma) return;
    if (vendorIds.length) {
      await prisma.receipt.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.transaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
    await prisma.$disconnect();
  });

  /** The Flavours of Millets: five quiches (two paneer), a Bhel Puri, both plans. */
  async function seed() {
    const tag = crypto.randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: {
        slug: `offers-test-${tag}`,
        name: `Offers Test ${tag}`,
        ownerName: "Test Owner",
        plan: "PRO",
        upiId: "test@upi",
        settings: {
          create: {
            publishStorefront: true,
            acceptMenuOrders: true,
            menuFulfilmentMode: "BOTH",
            menuDeliveryFeePaise: 3000,
          },
        },
        menuItems: {
          create: [
            { name: "Potato Corn Capsicum", priceInPaise: 5500, tags: ["quiche"] },
            { name: "Raw Banana Corn Zucchini", priceInPaise: 6500, tags: ["quiche"] },
            { name: "Paneer Carrot Zucchini", priceInPaise: 10000, tags: ["quiche", "Paneer"] },
            { name: "Paneer Broccoli Zucchini", priceInPaise: 11000, tags: ["quiche", "paneer"] },
            { name: "Potato Spinach Peas", priceInPaise: 6000, tags: ["quiche"] },
            { name: "Bhel Puri", priceInPaise: 4000, tags: ["snacks"] },
          ],
        },
        offers: {
          create: [
            {
              name: "Weekly Plan",
              eligibility: "TAG",
              eligibleTag: "quiche",
              minQty: 4,
              requiredTag: "paneer",
              requiredTagQty: 1,
              percentBps: 1000,
              createdAt: new Date("2026-10-01T00:00:00Z"),
            },
            {
              name: "Family Weekly Plan",
              eligibility: "TAG",
              eligibleTag: "quiche",
              minQty: 6,
              requiredTag: "paneer",
              requiredTagQty: 2,
              percentBps: 1200,
              createdAt: new Date("2026-10-02T00:00:00Z"),
            },
          ],
        },
      },
      include: { menuItems: true, offers: true },
    });
    vendorIds.push(vendor.id);
    const item = (name: string) => vendor.menuItems.find((m) => m.name === name)!;
    return {
      vendor,
      pcc: item("Potato Corn Capsicum"),
      rbz: item("Raw Banana Corn Zucchini"),
      pcz: item("Paneer Carrot Zucchini"),
      pbz: item("Paneer Broccoli Zucchini"),
      psp: item("Potato Spinach Peas"),
      bhel: item("Bhel Puri"),
      weekly: vendor.offers.find((o) => o.name === "Weekly Plan")!,
    };
  }

  const post = (url: string, body?: unknown) =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const buyer = {
    customerName: "Asha",
    customerPhone: "+919876543210",
    fulfilmentType: "PICKUP" as const,
    paymentMethod: "UPI" as const,
  };

  it("menu order: a tampered total is ignored, the bill and the Razorpay amount are the server's", async () => {
    const s = await seed();
    const { encryptSecret } = await import("@/lib/secret-box");
    const { keySecretAad, webhookSecretAad } = await import("@/lib/storefront-razorpay");
    await prisma.vendorSettings.update({
      where: { vendorId: s.vendor.id },
      data: {
        razorpayKeyId: KEY_ID,
        razorpayKeySecretEnc: encryptSecret(KEY_SECRET, keySecretAad(s.vendor.id)),
        razorpayWebhookSecretEnc: encryptSecret("offers_test_webhook_secret", webhookSecretAad(s.vendor.id)),
      },
    });

    const res = await placeMenuOrderRoute(
      post("http://t/x", {
        ...buyer,
        fulfilmentType: "DELIVERY",
        deliveryAddress: "12 Lake Road",
        items: [
          { menuItemId: s.pcc.id, qty: 1 },
          { menuItemId: s.rbz.id, qty: 1 },
          { menuItemId: s.pcz.id, qty: 1 },
          { menuItemId: s.psp.id, qty: 1 },
          { menuItemId: s.bhel.id, qty: 1 },
        ],
        // None of these are in the schema; a buyer who sends them gets nothing for it.
        totalPaise: 100,
        subtotalPaise: 100,
        discountPaise: 31_900,
        offerId: "made-up",
      }),
      { params: Promise.resolve({ slug: s.vendor.slug }) },
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { orderToken: string; totalPaise: number } };
    // Quiches ₹280 − 10% (₹28) + Bhel ₹40 + delivery ₹30.
    expect(data.totalPaise).toBe(28000 - 2800 + 4000 + 3000);

    const t = await prisma.transaction.findFirstOrThrow({
      where: { orderToken: data.orderToken, vendorId: s.vendor.id },
      include: { orderItems: true },
    });
    expect(t).toMatchObject({
      subtotalPaise: 32000,
      discountPaise: 2800,
      deliveryFeePaise: 3000,
      taxPaise: 0,
      totalPaise: 32200,
      offerId: s.weekly.id,
      offerName: "Weekly Plan",
    });
    expect(t.orderItems.reduce((sum, i) => sum + i.discountPaise, 0)).toBe(2800);
    expect(t.orderItems.find((i) => i.name === "Bhel Puri")!.discountPaise).toBe(0);

    const pay = await startPayment(post("http://t/x"), {
      params: Promise.resolve({ slug: s.vendor.slug, token: data.orderToken }),
    });
    expect(pay.status).toBe(200);
    const payData = ((await pay.json()) as { data: { amountPaise: number } }).data;
    expect(payData.amountPaise).toBe(32200);
    expect(rzAmounts.at(-1)).toBe(32200);

    // Receipt: the offer line is named and the totals reconcile.
    const receipt = await receiptData.loadVendorReceipt(s.vendor.id, { transactionId: t.id });
    const v = receipt!.view;
    expect(v.offerName).toBe("Weekly Plan");
    expect(v.subtotalPaise - v.discountPaise + v.deliveryFeePaise + v.taxPaise).toBe(v.totalPaise);
    expect(v.items.reduce((sum, i) => sum + i.priceInPaise * i.qty, 0)).toBe(v.subtotalPaise);
  });

  it("drop order: prices from DropItem, honours drop attachment and the on/off switch", async () => {
    const s = await seed();
    const now = new Date();
    const makeDrop = (title: string) =>
      prisma.drop.create({
        data: {
          vendorId: s.vendor.id,
          title,
          date: new Date("2026-10-17T00:00:00Z"),
          fulfilmentMode: "PICKUP",
          fulfilmentStartsAt: new Date(now.getTime() + 2 * 86_400_000),
          fulfilmentEndsAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
          closesAt: new Date(now.getTime() + 86_400_000),
          status: "OPEN",
          items: {
            create: [
              // Drop price differs from the menu price: the discount follows the drop's.
              { menuItemId: s.pcc.id, priceInPaise: 5000 },
              { menuItemId: s.pcz.id, priceInPaise: 10000 },
              { menuItemId: s.pbz.id, priceInPaise: 11000 },
            ],
          },
        },
        include: { items: true },
      });
    const saturday = await makeDrop("Saturday Bakes");
    const sunday = await makeDrop("Sunday Bakes");
    const dropItem = (d: typeof saturday, menuItemId: string) => d.items.find((i) => i.menuItemId === menuItemId)!;

    const order = (d: typeof saturday, qty: { pcc: number; pcz: number; pbz: number }) =>
      drops.placeStorefrontOrder({
        ...buyer,
        vendor: { id: s.vendor.id, plan: "PRO" },
        acceptPayOnDelivery: true,
        dropId: d.id,
        items: [
          { dropItemId: dropItem(d, s.pcc.id).id, qty: qty.pcc },
          { dropItemId: dropItem(d, s.pcz.id).id, qty: qty.pcz },
          { dropItemId: dropItem(d, s.pbz.id).id, qty: qty.pbz },
        ],
      });

    // 4 × ₹50 + ₹100 + ₹110 = ₹410, six quiches with two paneer → Family 12%.
    const family = await order(saturday, { pcc: 4, pcz: 1, pbz: 1 });
    expect(family.ok && family.order).toMatchObject({ subtotalPaise: 41000, discountPaise: 4920, totalPaise: 36080 });

    // Family now only on Sunday's drop: Saturday falls back to Weekly 10%.
    await prisma.offer.updateMany({
      where: { vendorId: s.vendor.id, name: "Family Weekly Plan" },
      data: { dropIds: [sunday.id] },
    });
    const weekly = await order(saturday, { pcc: 4, pcz: 1, pbz: 1 });
    expect(weekly.ok && weekly.order).toMatchObject({ discountPaise: 4100, totalPaise: 36900 });

    // Switched off or expired → full price.
    await prisma.offer.updateMany({ where: { vendorId: s.vendor.id }, data: { isActive: false } });
    const none = await order(saturday, { pcc: 4, pcz: 1, pbz: 1 });
    expect(none.ok && none.order).toMatchObject({ discountPaise: 0, totalPaise: 41000 });

    await prisma.offer.updateMany({
      where: { vendorId: s.vendor.id },
      data: { isActive: true, dropIds: [], endsAt: new Date(now.getTime() - 1000) },
    });
    const expired = await order(saturday, { pcc: 4, pcz: 1, pbz: 1 });
    expect(expired.ok && expired.order).toMatchObject({ discountPaise: 0, totalPaise: 41000 });
  });

  it("offers never cross tenants", async () => {
    const a = await seed();
    const b = await seed();
    await prisma.offer.deleteMany({ where: { vendorId: b.vendor.id } });
    // Vendor A's offers exist; vendor B's identical cart gets nothing.
    const check = await posOffers.checkPosDiscount(
      prisma,
      b.vendor.id,
      {
        items: [
          { menuItemId: b.pcc.id, priceInPaise: 5500, qty: 3 },
          { menuItemId: b.pcz.id, priceInPaise: 10000, qty: 1 },
        ],
        discountPaise: 2650,
        offerId: a.weekly.id,
        offerName: "Weekly Plan",
      },
      { deferred: false, saleAt: new Date() },
    );
    expect(check).toEqual({ ok: false, code: "discount_mismatch" });
  });

  it("counter sale: the server re-prices the discount", async () => {
    const s = await seed();
    const items = [
      { menuItemId: s.pcc.id, priceInPaise: 5500, qty: 3 },
      { menuItemId: s.pcz.id, priceInPaise: 10000, qty: 1 },
    ];
    const live = { deferred: false, saleAt: new Date() };

    // ₹265 of quiches, one paneer → 10% = ₹26.50.
    const ok = await posOffers.checkPosDiscount(prisma, s.vendor.id, { items, discountPaise: 2650 }, live);
    expect(ok).toMatchObject({ ok: true, offerId: s.weekly.id, offerName: "Weekly Plan", unverified: false });
    expect(ok.ok && ok.lineDiscounts).toEqual([1650, 1000]);

    // A bigger discount than the offers allow is refused before the sale is recorded.
    expect(await posOffers.checkPosDiscount(prisma, s.vendor.id, { items, discountPaise: 9000 }, live)).toEqual({
      ok: false,
      code: "discount_mismatch",
    });

    // A till that never loaded the offer charged full price: not tampering.
    expect(await posOffers.checkPosDiscount(prisma, s.vendor.id, { items, discountPaise: 0 }, live)).toMatchObject({
      ok: true,
      offerId: null,
      offerName: null,
    });

    // Rung up offline, offer switched off before it synced: the bill is kept as rung up.
    await prisma.offer.updateMany({ where: { vendorId: s.vendor.id }, data: { isActive: false } });
    const deferred = await posOffers.checkPosDiscount(
      prisma,
      s.vendor.id,
      { items, discountPaise: 2650, offerId: s.weekly.id, offerName: "Weekly Plan" },
      { deferred: true, saleAt: new Date() },
    );
    expect(deferred).toMatchObject({ ok: true, offerId: s.weekly.id, offerName: "Weekly Plan", unverified: true });
    expect(await posOffers.checkPosDiscount(prisma, s.vendor.id, { items, discountPaise: 2650 }, live)).toEqual({
      ok: false,
      code: "discount_mismatch",
    });
  });

  it("deleting an offer keeps the discount and its name on past bills", async () => {
    const s = await seed();
    const res = await placeMenuOrderRoute(
      post("http://t/x", {
        ...buyer,
        paymentMethod: "CASH",
        items: [
          { menuItemId: s.pcc.id, qty: 3 },
          { menuItemId: s.pcz.id, qty: 1 },
        ],
      }),
      { params: Promise.resolve({ slug: s.vendor.slug }) },
    );
    const { data } = (await res.json()) as { data: { orderToken: string } };
    await prisma.offer.deleteMany({ where: { vendorId: s.vendor.id } });
    const t = await prisma.transaction.findFirstOrThrow({ where: { orderToken: data.orderToken, vendorId: s.vendor.id } });
    expect(t).toMatchObject({ offerId: null, offerName: "Weekly Plan", discountPaise: 2650, totalPaise: 23850 });
  });
});
