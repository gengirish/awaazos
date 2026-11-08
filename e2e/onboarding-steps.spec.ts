import { expect, test } from "@playwright/test";

import { registerVendor, signIn } from "./helpers/vendor";

/**
 * First-run setup asks for an answer on every step (docs/ONBOARDING_PLAN.md):
 * a way to get paid, at least one item. Writes real rows (vendors, menu
 * items): throwaway Postgres only (CLAUDE.md).
 */

const NEXT = { name: "Next", exact: true } as const;

test.describe("setup steps", () => {
  test("getting paid needs a way to pay; what you sell needs an item; nothing is skippable", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const creds = await registerVendor(request, "onb-steps");
    await signIn(page, creds, "/onboarding");

    await page.getByLabel("City").fill("Pune");
    await page.getByLabel("State").fill("Maharashtra");
    await page.getByRole("button", NEXT).click();

    // ── Getting paid: UPI is ticked to begin with, pay on delivery is not ──
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    const upi = page.getByRole("checkbox", { name: /^UPI/ });
    const pod = page.getByRole("checkbox", { name: /^Pay on delivery/ });
    await expect(upi).toBeChecked();
    await expect(pod).not.toBeChecked();

    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Enter your UPI ID, or untick UPI.")).toBeVisible();
    await expect(page.getByLabel("UPI ID", { exact: true })).toBeFocused();

    await upi.uncheck();
    await expect(page.getByLabel("UPI ID", { exact: true })).toHaveCount(0);
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose at least one way customers can pay you." })).toBeVisible();

    await pod.check();
    await page.getByRole("button", NEXT).click();

    // ── What you sell: one item with a price, typed ──
    await expect(page.getByRole("heading", { name: "What you sell" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Add at least one dish with its price.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Puran Poli");
    await page.getByLabel("Price (₹)").fill("60");
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("heading", { name: "Order alerts" })).toBeVisible();

    const res = await page.request.get("/api/vendor");
    const { vendor } = (await res.json()) as {
      vendor: { upiId: string | null; onboardingStep: number | null; settings: { acceptPayOnDelivery: boolean } };
    };
    expect(vendor.upiId).toBeNull();
    expect(vendor.settings.acceptPayOnDelivery).toBe(true);
    expect(vendor.onboardingStep).toBe(3);

    // A reload reopens the step after the last one answered, and the payment step shows what was saved.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Order alerts" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(upi).not.toBeChecked();
    await expect(pod).toBeChecked();
  });

  test("Connect Razorpay comes back to setup, and only to setup or Settings", async ({ page, request }) => {
    const creds = await registerVendor(request, "onb-rzp");
    await signIn(page, creds, "/onboarding");
    await page.getByLabel("City").fill("Pune");
    await page.getByLabel("State").fill("Maharashtra");
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();

    // No Razorpay partner app here, so the connect route answers "unavailable" at once.
    const connect = "/api/vendor/payments/razorpay/connect";
    const location = async (path: string) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(303);
      return new URL(res.headers().location!).pathname + new URL(res.headers().location!).search;
    };
    expect(await location(`${connect}?return=onboarding`)).toBe("/onboarding?razorpay=unavailable");
    expect(await location(connect)).toBe("/settings/payments?razorpay=unavailable");
    expect(await location(`${connect}?return=${encodeURIComponent("https://example.com/")}`)).toBe(
      "/settings/payments?razorpay=unavailable",
    );

    // Coming back opens the payment step with the outcome on it.
    await page.goto("/onboarding?razorpay=unavailable");
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Connect Razorpay isn't switched on" })).toBeVisible();
  });
});
