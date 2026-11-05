import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { CAN_SET_BILLING, markPaidOnlineByOrderId, setRazorpayKeysBySlug } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * A store with Razorpay shows "Pay online" alone, and checkout opens its window with
 * no second tap. Direct UPI and "Payment done?" appear once Razorpay fails or the
 * buyer asks for them after closing the window, and never when they may already have paid.
 *
 * No real Razorpay: the keys are placeholders written to the database, the start
 * and verify calls are mocked, and `window.Razorpay` is a stub.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md). Needs
 * PAYMENT_KEYS_ENCRYPTION_KEY on the server, or "Pay online" isn't offered.
 */

const UPI_ID = "e2e-rzp-first@okaxis";
const JSON_HEADERS = { "Content-Type": "application/json" };
const PAY_ONLINE = "Pay ₹120.00 online";
const PAY_UPI = "Pay ₹120.00 with a UPI app";

const START_OK = {
  data: { keyId: "rzp_test_e2e", razorpayOrderId: "order_e2e", amountPaise: 12000, currency: "INR", name: "Store", billNumber: "B" },
};

async function placeOrder(buyer: Page, slug: string, item: string): Promise<void> {
  await buyer.goto(`/s/${slug}`);
  await buyer.getByRole("button", { name: `Add ${item}` }).click();
  await buyer.getByRole("button", { name: "Checkout" }).click();
  const sheet = buyer.getByRole("dialog", { name: "Checkout" });
  await sheet.getByLabel("Your name").fill("Online Buyer");
  await sheet.getByLabel("Mobile number").fill("98480 54321");
  const payOnline = sheet.getByRole("radio", { name: /pay online/i });
  // The store with no other way to pay shows no radios at all.
  if (await payOnline.count()) await payOnline.check();
  await sheet.getByRole("button", { name: /^pay ₹120\.00$/i }).click();
  await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/?]+$`), { timeout: 120_000 });
}

function mockStart(buyer: Page, status: number, body: unknown) {
  return buyer.route("**/razorpay", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
      : route.continue(),
  );
}

const rzpOpens = (buyer: Page) => buyer.evaluate(() => (window as unknown as { __rzpOpens: number }).__rzpOpens);

async function expectDirectPay(buyer: Page, visible: boolean) {
  const count = visible ? 1 : 0;
  await expect(buyer.getByRole("link", { name: PAY_UPI })).toHaveCount(count);
  await expect(buyer.getByRole("heading", { name: "Payment done?" })).toHaveCount(count);
}

test.describe("Razorpay first on the order page", () => {
  test.skip(!CAN_SET_BILLING, "needs a local throwaway database");

  test("UPI waits until Razorpay fails", async ({ page, request, browser }) => {
    test.setTimeout(300_000);

    const item = `Mysore Pak ${Math.random().toString(36).slice(2, 7)}`;
    await createVendorSession(page, request, "rzpfirst", "/menu");
    const vendorRes = await page.request.get("/api/vendor");
    const slug = ((await vendorRes.json()) as { vendor: { slug: string } }).vendor.slug;
    await createMenuItem(page, { name: item, priceInRupees: 120, category: "Sweets" });
    for (const data of [
      { upiId: UPI_ID, upiName: "E2E Kitchen" },
      { publishStorefront: true },
      { acceptMenuOrders: true },
    ]) {
      const res = await page.request.patch("/api/vendor", { data, headers: JSON_HEADERS });
      expect(res.status(), JSON.stringify(data)).toBe(200);
    }
    await setRazorpayKeysBySlug(slug);

    // One browser per order: checkout shows a returning buyer's saved details as a card.
    const contexts: BrowserContext[] = [];
    type InWindow = "stay" | "close" | "pay";
    async function newBuyer(inWindow: InWindow = "stay"): Promise<Page> {
      const ctx = await browser.newContext(CONTEXT_OPTIONS);
      contexts.push(ctx);
      // Stands in for checkout.js: `inWindow` is what the buyer does in the window.
      await ctx.addInitScript((script: InWindow) => {
        type Opts = { handler: (r: unknown) => void; modal: { ondismiss: () => void } };
        const w = window as unknown as { Razorpay: unknown; __rzpOpens: number };
        w.__rzpOpens = 0;
        w.Razorpay = class {
          constructor(private o: Opts) {}
          on() {}
          open() {
            w.__rzpOpens += 1;
            if (script === "stay") return;
            if (script === "pay") {
              this.o.handler({ razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "s" });
            }
            this.o.modal.ondismiss();
          }
        };
      }, inWindow);
      return ctx.newPage();
    }

    try {
      // ── Healthy: one tap at checkout opens the window, once ─────────
      const refused = await newBuyer();
      await mockStart(refused, 200, START_OK);
      await placeOrder(refused, slug, item);
      await expect.poll(() => rzpOpens(refused)).toBe(1);
      await expect(refused.getByRole("button", { name: PAY_ONLINE })).toBeEnabled();
      await expectDirectPay(refused, false);
      await refused.reload();
      await expect(refused.getByRole("button", { name: PAY_ONLINE })).toBeVisible();
      expect(new URL(refused.url()).search).toBe("");
      expect(await rzpOpens(refused)).toBe(0);
      await refused.unroute("**/razorpay");

      // ── WhatsApp goes first: the window waits ───────────────────────
      const orderUrl = refused.url();
      await refused.goto(`${orderUrl}?wa=1&pay=1`);
      await expect(refused.getByRole("button", { name: PAY_ONLINE })).toBeVisible();
      expect(await rzpOpens(refused)).toBe(0);
      await refused.goto(orderUrl);

      // ── Payment still being confirmed: stays closed, or they'd pay twice ──
      await mockStart(refused, 409, { error: "payment_processing" });
      await refused.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(refused.getByText(/your payment went through/i)).toBeVisible();
      await expectDirectPay(refused, false);
      await refused.unroute("**/razorpay");

      // ── Razorpay refuses the store: UPI opens, and survives a reload ──
      await mockStart(refused, 409, { error: "online_payment_unavailable" });
      await refused.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(refused.getByText(/please pay by upi below/i)).toBeVisible();
      await expectDirectPay(refused, true);
      await refused.reload();
      await expectDirectPay(refused, true);

      // ── Buyer closes the Razorpay window: UPI waits behind a link ───
      const closer = await newBuyer("close");
      await mockStart(closer, 200, START_OK);
      await placeOrder(closer, slug, item);
      await expect(closer.getByText(/payment cancelled/i)).toBeVisible();
      await expectDirectPay(closer, false);
      await closer.getByRole("button", { name: "Pay by UPI instead" }).click();
      await expectDirectPay(closer, true);
      await expect(closer.getByRole("button", { name: "Pay by UPI instead" })).toHaveCount(0);

      // ── Paid, but our confirmation failed: stays closed ─────────────
      const paid = await newBuyer("pay");
      await mockStart(paid, 200, START_OK);
      await paid.route("**/razorpay/verify", (route) => route.fulfill({ status: 502, body: "{}" }));
      await placeOrder(paid, slug, item);
      await expect(paid.getByText(/please don't pay again/i)).toBeVisible();
      await expectDirectPay(paid, false);
      await expect(paid.getByRole("button", { name: "Pay by UPI instead" })).toHaveCount(0);

      // ── Razorpay alone, no UPI ID and no pay on delivery: still takes an order,
      // and the error names no way out it can't deliver ──
      for (const data of [{ acceptPayOnDelivery: false }, { upiId: null }]) {
        const res = await page.request.patch("/api/vendor", { data, headers: JSON_HEADERS });
        expect(res.status(), JSON.stringify(data)).toBe(200);
      }
      const noUpi = await newBuyer();
      await mockStart(noUpi, 409, { error: "online_payment_unavailable" });
      await placeOrder(noUpi, slug, item);
      await expect(noUpi.getByText(/please try again later/i)).toBeVisible();
      await expect(noUpi.getByText(/pay by upi/i)).toHaveCount(0);
      await expect(noUpi.getByRole("heading", { name: "Payment done?" })).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("the seller only has to deal with an order once it is paid", async ({ page, request, browser }) => {
    test.setTimeout(300_000);

    const item = `Kaju Katli ${Math.random().toString(36).slice(2, 7)}`;
    await createVendorSession(page, request, "rzppaid", "/menu");
    const vendorRes = await page.request.get("/api/vendor");
    const slug = ((await vendorRes.json()) as { vendor: { slug: string } }).vendor.slug;
    await createMenuItem(page, { name: item, priceInRupees: 120, category: "Sweets" });
    for (const data of [
      { upiId: UPI_ID, upiName: "E2E Kitchen" },
      { publishStorefront: true },
      { acceptMenuOrders: true },
    ]) {
      const res = await page.request.patch("/api/vendor", { data, headers: JSON_HEADERS });
      expect(res.status(), JSON.stringify(data)).toBe(200);
    }
    await setRazorpayKeysBySlug(slug);

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await placeOrder(buyer, slug, item);
      await expect(buyer.getByRole("button", { name: PAY_ONLINE })).toBeVisible();

      // ── Not paid: not in Needs action, not counted, under All with only Cancel ──
      await page.goto("/orders");
      const card = page.getByRole("article").filter({ hasText: "Online Buyer" });
      await expect(page.getByRole("tab", { name: /needs action \(0\)/i })).toBeVisible();
      await expect(card).toHaveCount(0);
      await page.getByRole("tab", { name: /^all \(1\)/i }).click();
      await expect(card).toBeVisible();
      await expect(card.getByText("Awaiting payment")).toBeVisible();
      await expect(card.getByRole("checkbox")).toHaveCount(0);
      await card.getByRole("button", { name: /show details/i }).click();
      await expect(card.getByText(/hasn.t paid yet/i)).toBeVisible();
      await expect(card.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /payment received/i })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /^delivered|^picked up/i })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /cancel order/i })).toBeVisible();

      // ── A stale board or a direct call can't confirm it either ──
      const list = (await (await page.request.get("/api/storefront-orders")).json()) as { data: { id: string }[] };
      const orderId = list.data[0]!.id;
      const refused = await page.request.patch(`/api/storefront-orders/${orderId}`, {
        data: { action: "confirm" },
        headers: JSON_HEADERS,
      });
      expect(refused.status()).toBe(409);

      // ── Paid: confirmed for the seller, one next step, and the buyer's page agrees ──
      await markPaidOnlineByOrderId(orderId);
      await page.goto("/orders");
      await expect(page.getByRole("tab", { name: /needs action \(0\)/i })).toBeVisible();
      await page.getByRole("tab", { name: /confirmed \(1\)/i }).click();
      await expect(card).toBeVisible();
      await expect(card.getByText("Paid online")).toBeVisible();
      await expect(card.getByRole("button", { name: "Picked up" })).toBeVisible();

      await buyer.reload();
      const progress = buyer.getByRole("list", { name: "Order progress" });
      await expect(progress.getByText("Paid", { exact: true })).toBeVisible();
      await expect(progress.getByText("Confirmed", { exact: true })).toHaveCount(0);
      await expect(buyer.getByText("Paid online")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
