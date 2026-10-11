import { expect, test, type Page } from "@playwright/test";

import { registerOwnerAndSignIn } from "./helpers/register-owner";

test.describe("Razorpay create-subscription API", () => {
  test("POST without session returns 401", async ({ request }) => {
    const res = await request.post("/api/razorpay/create-subscription", {
      data: { plan: "PRO" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/unauthorized/i);
  });

  test("POST without session returns 401 even with invalid plan body", async ({ request }) => {
    const res = await request.post("/api/razorpay/create-subscription", {
      data: { plan: "NOT_A_PLAN" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("verify-subscription API", () => {
  test("POST without session returns 401", async ({ request }) => {
    const res = await request.post("/api/razorpay/verify-subscription", {
      data: { razorpay_payment_id: "pay_x", razorpay_subscription_id: "sub_x", razorpay_signature: "ab" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});

/**
 * In-app Checkout for the platform subscription (components/billing/
 * BillingManageClient.tsx). No real payment: create-subscription and
 * verify-subscription are mocked, and checkout.js is replaced by a stub whose
 * behaviour each test picks. The real routes are covered by
 * lib/__tests__/subscription-verify.db.test.ts and subscription-webhook.db.test.ts.
 */
const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

type StubMode = "pay" | "dismiss";

/** A window.Razorpay that records its options, then pays or closes as soon as it opens. */
function checkoutStub(mode: StubMode): string {
  return `
    window.Razorpay = function (o) {
      window.__rzpOptions = {
        key: o.key,
        subscription_id: o.subscription_id,
        name: o.name,
        description: o.description,
        prefill: o.prefill,
      };
      this.on = function () {};
      this.open = function () {
        setTimeout(function () {
          if (${JSON.stringify(mode)} === "pay") {
            o.handler({
              razorpay_payment_id: "pay_e2e_mock",
              razorpay_subscription_id: o.subscription_id,
              razorpay_signature: "sig_e2e_mock",
            });
          } else {
            o.modal.ondismiss();
          }
        }, 0);
      };
    };`;
}

test.describe("Billing page — subscribe with in-app Checkout", () => {
  const base = process.env.BASE_URL ?? "http://localhost:3000";

  async function mockCreate(page: Page, onBody: (body: string | null) => void = () => {}) {
    await page.route("**/api/razorpay/create-subscription", async (route) => {
      onBody(route.request().postData() ?? null);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          subscriptionId: "sub_e2e_mock",
          shortUrl: `${base}/pricing`,
          keyId: "rzp_test_e2e_mock",
        }),
      });
    });
  }

  async function mockCheckout(page: Page, mode: StubMode) {
    await page.route(CHECKOUT_JS, (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: checkoutStub(mode) }),
    );
  }

  for (const interval of ["monthly", "yearly"] as const) {
    test(`owner on the free trial pays for Starter ${interval} without leaving the app`, async ({
      page,
      request,
    }) => {
      let createBody: string | null = null;
      let verifyBody: string | null = null;
      await mockCreate(page, (b) => (createBody = b));
      await mockCheckout(page, "pay");
      await page.route("**/api/razorpay/verify-subscription", async (route) => {
        verifyBody = route.request().postData() ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { status: "active", active: true } }),
        });
      });

      await registerOwnerAndSignIn(page, request);

      await expect(page.getByRole("heading", { name: /billing/i })).toBeVisible();
      // The accessible name also carries the price line ("… + GST = ₹352.82").
      const button = page.getByRole("button", { name: new RegExp(`^starter ${interval}`, "i") });
      await expect(button).toBeVisible();
      await expect(button).toContainText("+ GST");

      await button.click();

      await expect.poll(() => createBody, { timeout: 15_000 }).toBeTruthy();
      expect(JSON.parse(createBody!)).toEqual({ plan: "STARTER", interval });

      // Checkout's success is handed to the server untouched, for it to verify.
      await expect.poll(() => verifyBody, { timeout: 15_000 }).toBeTruthy();
      expect(JSON.parse(verifyBody!)).toEqual({
        razorpay_payment_id: "pay_e2e_mock",
        razorpay_subscription_id: "sub_e2e_mock",
        razorpay_signature: "sig_e2e_mock",
      });

      // Still in the app — never sent to Razorpay's hosted page.
      await expect(page).toHaveURL(/\/settings\/billing/);
    });
  }

  test("Checkout gets the platform key, this subscription, and only the owner's own details", async ({
    page,
    request,
  }) => {
    await mockCreate(page);
    // "dismiss" keeps the page from reloading, so the recorded options can be read.
    await mockCheckout(page, "dismiss");

    await registerOwnerAndSignIn(page, request);
    await page.getByRole("button", { name: /^starter yearly/i }).click();
    await expect(page.getByText(/payment cancelled/i)).toBeVisible();

    const options = await page.evaluate(
      () => (window as unknown as { __rzpOptions?: Record<string, unknown> }).__rzpOptions,
    );
    expect(options).toMatchObject({
      key: "rzp_test_e2e_mock",
      subscription_id: "sub_e2e_mock",
      name: "AwaazOS",
      prefill: { name: "E2E Billing Vendor" },
    });
    expect((options?.prefill as { email?: string }).email).toMatch(/^e2e-rzp-.*@example\.com$/);
    expect(String(options?.description)).toMatch(/starter yearly/i);
    expect(String(options?.description)).toContain("3,528.20");
  });

  test("closing the payment window charges nothing and lets the owner try again", async ({ page, request }) => {
    let verifyCalls = 0;
    await mockCreate(page);
    await mockCheckout(page, "dismiss");
    await page.route("**/api/razorpay/verify-subscription", async (route) => {
      verifyCalls++;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    await registerOwnerAndSignIn(page, request);
    const button = page.getByRole("button", { name: /^starter monthly/i });
    await button.click();

    await expect(page.getByText(/payment cancelled\. nothing was charged/i)).toBeVisible();
    await expect(button).toBeEnabled();
    expect(verifyCalls).toBe(0);
    await expect(page).toHaveURL(/\/settings\/billing/);
  });

  test("paid but not confirmed yet: told to refresh, never to pay again", async ({ page, request }) => {
    let verifyCalls = 0;
    await mockCreate(page);
    await mockCheckout(page, "pay");
    await page.route("**/api/razorpay/verify-subscription", async (route) => {
      verifyCalls++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { status: "authenticated", active: false } }),
      });
    });

    await registerOwnerAndSignIn(page, request);
    await page.getByRole("button", { name: /^starter monthly/i }).click();

    await expect(page.getByText(/payment received\. your plan will switch on/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/please don't pay again/i)).toBeVisible();
    // A bounded number of confirmations, not a loop.
    expect(verifyCalls).toBe(3);
  });

  test("a payment the server can't match shows a clear error", async ({ page, request }) => {
    await mockCreate(page);
    await mockCheckout(page, "pay");
    await page.route("**/api/razorpay/verify-subscription", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_signature" }),
      }),
    );

    await registerOwnerAndSignIn(page, request);
    await page.getByRole("button", { name: /^starter monthly/i }).click();

    await expect(page.getByRole("alert").filter({ hasText: /couldn't match that payment/i })).toBeVisible();
  });

  test("falls back to Razorpay's hosted page when checkout.js can't load", async ({ page, request }) => {
    await mockCreate(page);
    await page.route(CHECKOUT_JS, (route) => route.abort());

    await registerOwnerAndSignIn(page, request);
    await page.getByRole("button", { name: /^starter monthly/i }).click();

    // The mocked short_url points at /pricing.
    await page.waitForURL(/\/pricing/, { timeout: 15_000 });
  });
});
