import { expect, test, type Page } from "@playwright/test";

import { createLoginToken } from "../lib/customer-auth";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * A signed-in storefront buyer can sign out from the store header and from the
 * top of the account page — not only from the bottom of the profile form.
 *
 * Signs in through the real magic-link route: the test mints a login token
 * directly (no email in CI) and opens /api/s/customer/verify like the email
 * link would. Writes rows — throwaway DB only (see CLAUDE.md).
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { vendor: { slug: string } }).vendor.slug;
}

test.describe("storefront buyer sign-out", () => {
  test("signed-in buyer can sign out from the store header and the account page", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);

    // Vendor with a published storefront.
    await createVendorSession(page, request, "signout", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: `Masala Chai ${suffix}`, priceInRupees: 20, category: "Drinks" });
    const pub = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(pub.ok()).toBe(true);

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      const signIn = async () => {
        const { rawToken } = await createLoginToken(`buyer-${suffix}@example.com`, `/s/${slug}`);
        await buyer.goto(`/api/s/customer/verify?token=${encodeURIComponent(rawToken)}`);
        await buyer.waitForURL(new RegExp(`/s/${slug}$`));
      };

      // 1) Store header: "My orders" + "Sign out" side by side.
      await signIn();
      await expect(buyer.getByRole("link", { name: /my orders/i })).toBeVisible();
      await buyer.getByRole("button", { name: "Sign out" }).click();
      await expect(buyer.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
      await expect(buyer.getByRole("button", { name: "Sign out" })).toHaveCount(0);
      // The session is really gone server-side, not just hidden.
      expect((await buyer.request.get("/api/s/customer/profile")).status()).toBe(401);

      // 2) Account page: Sign out is in the header, no scrolling needed.
      await signIn();
      await buyer.goto(`/s/${slug}/account`);
      const header = buyer.getByRole("banner");
      await header.getByRole("button", { name: "Sign out" }).click();
      await expect(buyer.getByRole("heading", { level: 1, name: /sign in to/i })).toBeVisible();
      expect((await buyer.request.get("/api/s/customer/profile")).status()).toBe(401);

      // 3) Guests never see a Sign out button.
      await buyer.goto(`/s/${slug}`);
      await expect(buyer.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    } finally {
      await buyerCtx.close();
    }
  });
});
