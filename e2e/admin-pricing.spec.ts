import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, setPlatformRole } from "./helpers/billing-db";
import { createVendorSession } from "./helpers/vendor";
import { BRAND_NAME } from "../lib/brand";

/** Pricing calculator (lib/pricing-calculator.ts): the two Razorpay bills it models. */
test.describe("admin pricing calculator", () => {
  test("a store owner with no platform role gets 404", async ({ page, request }) => {
    await createVendorSession(page, request, "pricing-none");
    expect((await page.goto("/admin/pricing"))?.status()).toBe(404);
  });

  test.describe("with a platform role set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

    test("adds instant settlement to the kitchen's cost and nets Razorpay off our revenue", async ({
      page,
      request,
    }) => {
      const creds = await createVendorSession(page, request, "pricing-admin");
      await setPlatformRole(creds.email, "ADMIN");
      await page.goto("/admin/pricing");

      // Standard settlement is free, so there is no line for it.
      const settlementRow = page.getByRole("row", { name: /Instant settlement/ });
      await expect(page.getByRole("row", { name: /Razorpay fees/ })).toContainText("₹2,360");
      await expect(settlementRow).toHaveCount(0);

      // ₹1L through the gateway: ₹97,640 settled, 0.30% + GST.
      await page.getByLabel("Settlement", { exact: true }).selectOption("instant");
      await expect(settlementRow).toContainText("₹345");

      await page.getByLabel("Instant settlement fee (%)").fill("0.2");
      await expect(settlementRow).toContainText("₹230");

      // 20 kitchens at ₹649: ₹12,980, less ₹18.06 each to Razorpay.
      await page.getByRole("tab", { name: `${BRAND_NAME} revenue` }).click();
      await expect(page.getByRole("row", { name: /^Per month/ })).toContainText("₹12,980");
      await expect(page.getByRole("row", { name: /Razorpay fee on our charges/ })).toContainText("₹361");
      await expect(page.getByRole("row", { name: /We keep, per month/ })).toContainText("₹12,618");

      // Commission is unknown until it is typed in.
      const commissionRow = page.getByRole("row", { name: /Partner commission/ });
      await expect(commissionRow).toHaveCount(0);
      await page.getByLabel("Partner commission (%)").fill("0.1");
      await expect(commissionRow).toBeVisible();
    });
  });
});
