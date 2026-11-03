import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setRazorpayKeysBySlug } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * A store with Razorpay shows "Pay online" alone. Direct UPI and "Payment done?"
 * appear only once Razorpay fails, and never when the buyer may already have paid.
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
  await sheet.getByRole("radio", { name: /pay now by upi/i }).check();
  await sheet.getByRole("button", { name: /place order(?: & pay)? · ₹120\.00/i }).click();
  await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
}

function mockStart(buyer: Page, status: number, body: unknown) {
  return buyer.route("**/razorpay", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
      : route.continue(),
  );
}

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

    const ctx: BrowserContext = await browser.newContext(CONTEXT_OPTIONS);
    // Stands in for checkout.js. `__rzpScript` picks what the buyer does in the window.
    await ctx.addInitScript(() => {
      type Opts = { handler: (r: unknown) => void; modal: { ondismiss: () => void } };
      (window as unknown as { Razorpay: unknown }).Razorpay = class {
        constructor(private o: Opts) {}
        on() {}
        open() {
          if (localStorage.getItem("__rzpScript") === "paid") {
            this.o.handler({ razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "s" });
          }
          this.o.modal.ondismiss();
        }
      };
    });

    try {
      // ── Healthy: the Razorpay button alone ──────────────────────────
      const buyer = await ctx.newPage();
      await placeOrder(buyer, slug, item);
      await expect(buyer.getByRole("button", { name: PAY_ONLINE })).toBeVisible();
      await expectDirectPay(buyer, false);

      // ── Payment still being confirmed: stays closed, or they'd pay twice ──
      await mockStart(buyer, 409, { error: "payment_processing" });
      await buyer.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(buyer.getByText(/your payment went through/i)).toBeVisible();
      await expectDirectPay(buyer, false);
      await buyer.unroute("**/razorpay");

      // ── Razorpay refuses the store: UPI opens, and survives a reload ──
      await mockStart(buyer, 409, { error: "online_payment_unavailable" });
      await buyer.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(buyer.getByText(/please pay by upi below/i)).toBeVisible();
      await expectDirectPay(buyer, true);
      await buyer.reload();
      await expectDirectPay(buyer, true);
      await buyer.unroute("**/razorpay");

      // ── Buyer closes the Razorpay window: UPI opens ─────────────────
      await placeOrder(buyer, slug, item);
      await expectDirectPay(buyer, false);
      await mockStart(buyer, 200, START_OK);
      await buyer.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(buyer.getByText(/payment cancelled/i)).toBeVisible();
      await expectDirectPay(buyer, true);
      await buyer.unroute("**/razorpay");

      // ── Paid, but our confirmation failed: stays closed ─────────────
      await placeOrder(buyer, slug, item);
      await buyer.evaluate(() => localStorage.setItem("__rzpScript", "paid"));
      await mockStart(buyer, 200, START_OK);
      await buyer.route("**/razorpay/verify", (route) => route.fulfill({ status: 502, body: "{}" }));
      await buyer.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(buyer.getByText(/please don't pay again/i)).toBeVisible();
      await expectDirectPay(buyer, false);
      await buyer.unroute("**/razorpay");
      await buyer.unroute("**/razorpay/verify");
      await buyer.evaluate(() => localStorage.removeItem("__rzpScript"));

      // ── No UPI ID left: the error names no way out it can't deliver ──
      await placeOrder(buyer, slug, item);
      const cleared = await page.request.patch("/api/vendor", { data: { upiId: null }, headers: JSON_HEADERS });
      expect(cleared.status()).toBe(200);
      await buyer.reload();
      await mockStart(buyer, 409, { error: "online_payment_unavailable" });
      await buyer.getByRole("button", { name: PAY_ONLINE }).click();
      await expect(buyer.getByText(/please try again later/i)).toBeVisible();
      await expect(buyer.getByText(/pay by upi/i)).toHaveCount(0);
      await expect(buyer.getByRole("heading", { name: "Payment done?" })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
