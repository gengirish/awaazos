import { expect, test, type Page } from "@playwright/test";

import { CAN_SET_BILLING, daysFromNow, setVendorBilling, setVendorSubscription } from "./helpers/billing-db";
import { createVendorSession, E2E_PASSWORD, registerVendor } from "./helpers/vendor";

/**
 * The way back from a cancelled subscription (lib/billing-actions.ts). Before
 * this, /settings/billing and /pricing only linked to each other. No real payment:
 * checkout.js is a stub; the create route is mocked where it would reach Razorpay.
 */
const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

/** A window.Razorpay that records its subscription id and closes as soon as it opens. */
const CHECKOUT_STUB = `
  window.Razorpay = function (o) {
    window.__rzpSubscriptionId = o.subscription_id;
    this.on = function () {};
    this.open = function () { setTimeout(function () { o.modal.ondismiss(); }, 0); };
  };`;

async function mockSubscribe(page: Page, onBody: (body: string | null) => void) {
  await page.route(CHECKOUT_JS, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: CHECKOUT_STUB }),
  );
  await page.route("**/api/razorpay/create-subscription", (route) => {
    onBody(route.request().postData() ?? null);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ subscriptionId: "sub_e2e_mock", shortUrl: "", keyId: "rzp_test_e2e_mock" }),
    });
  });
}

test.describe("with billing state set in the database", () => {
  test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set the subscription");

  async function cancelledStore(page: Page, request: Parameters<typeof createVendorSession>[1], name: string) {
    const creds = await createVendorSession(page, request, name);
    await setVendorBilling(creds.email, { plan: "STARTER", planExpiresAt: daysFromNow(5), trialEndsAt: daysFromNow(-20) });
    await setVendorSubscription(creds.email, {
      razorpaySubId: "sub_e2e_old",
      razorpaySubStatus: "active",
      razorpaySubCancelAtEnd: true,
    });
    return creds;
  }

  test("cancelled, Choose Starter yearly on /pricing, and billing opens Checkout for it", async ({ page, request }) => {
    let createBody: string | null = null;
    await mockSubscribe(page, (b) => (createBody = b));
    await cancelledStore(page, request, "resub-flow");

    await page.goto("/pricing");
    await expect(page.getByRole("link", { name: "Go to dashboard" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);

    await page.getByRole("link", { name: "Choose Starter yearly" }).click();
    await expect(page).toHaveURL(/\/settings\/billing\?plan=starter&interval=yearly/);

    await expect(page.getByText(/paid until/i)).toBeVisible();
    await expect(page.getByRole("radio", { name: /^starter/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^yearly/i })).toBeChecked();
    await expect(page.getByText(/, exclusive of 18% GST/)).toBeVisible();
    await expect(page.getByText(/nothing is charged today/i)).toBeVisible();

    await page.getByRole("button", { name: /^resubscribe — starter yearly/i }).click();

    await expect.poll(() => createBody, { timeout: 15_000 }).toBeTruthy();
    expect(JSON.parse(createBody!)).toEqual({ plan: "STARTER", interval: "yearly" });
    await expect(page.getByText(/payment cancelled\. nothing was charged/i)).toBeVisible();
    const opened = await page.evaluate(() => (window as unknown as { __rzpSubscriptionId?: string }).__rzpSubscriptionId);
    expect(opened).toBe("sub_e2e_mock");
    // Still able to try again.
    await expect(page.getByRole("button", { name: /^resubscribe — starter yearly/i })).toBeEnabled();
  });

  test("the reported store: its own price, cancelled, is offered Starter and told why Pro isn't", async ({
    page,
    request,
  }) => {
    const creds = await cancelledStore(page, request, "resub-own-price");
    await setVendorBilling(creds.email, { customPricePaise: 29_900 });

    await page.goto("/settings/billing?plan=pro&interval=monthly");

    await expect(page.getByRole("radio", { name: /^starter/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^pro/i })).toHaveCount(0);
    await expect(page.getByText(/its own price on the starter plan/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^resubscribe — starter monthly/i })).toBeVisible();
  });

  test("a higher plan while cancelled says it is charged today", async ({ page, request }) => {
    await cancelledStore(page, request, "resub-higher");

    await page.goto("/settings/billing?plan=pro&interval=monthly");

    await expect(page.getByRole("radio", { name: /^pro/i })).toBeChecked();
    await expect(page.getByText(/starts today and is charged today/i)).toBeVisible();
  });

  test("a live subscription can't start a second one through the API", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "resub-duplicate");
    await setVendorBilling(creds.email, { plan: "STARTER", planExpiresAt: daysFromNow(20) });
    // No Razorpay keys here: the stored status is what refuses.
    await setVendorSubscription(creds.email, { razorpaySubId: "sub_e2e_live", razorpaySubStatus: "active" });

    const res = await page.request.post("/api/razorpay/create-subscription", {
      data: { plan: "STARTER", interval: "monthly" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already/i);

    await page.goto("/settings/billing");
    await expect(page.getByRole("radio", { name: /^starter/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cancel subscription/i })).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("the pick survives sign-up's link to sign-in, and signing in lands on it", async ({ page, request }) => {
    const creds = await registerVendor(request, "resub-signed-out");

    await page.goto("/pricing");
    await expect(page.getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);

    await page.getByRole("link", { name: "Start free, then Starter yearly" }).click();
    await expect(page).toHaveURL(/\/sign-up\?callbackUrl=/);
    await page.getByRole("link", { name: /^sign in$/i }).last().click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);

    await page.getByLabel(/email/i).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL(/\/settings\/billing\?plan=starter&interval=yearly/, { timeout: 45_000 });
    await expect(page.getByRole("radio", { name: /^yearly/i })).toBeChecked();
  });
});
