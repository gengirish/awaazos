import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The public storefront is the only unauthenticated read of tenant data, so
 * these tests are as much about what does NOT render as what does.
 */

async function vendorSlug(page: import("@playwright/test").Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

async function setPublished(
  page: import("@playwright/test").Page,
  publishStorefront: boolean,
): Promise<void> {
  const res = await page.request.patch("/api/vendor", {
    data: { publishStorefront },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok(), `PATCH publishStorefront=${publishStorefront}`).toBe(true);
}

test.describe("public storefront", () => {
  test("404s until the vendor opts in, then renders menu and prices", async ({
    page,
    request,
    browser,
  }) => {
    await createVendorSession(page, request, "storefront", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Special Chai", priceInRupees: 20, category: "Drinks" });

    // A fresh browser context: no session cookie, exactly like a customer.
    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const anonPage = await anon.newPage();

    try {
      const priv = await anonPage.goto(`/s/${slug}`);
      expect(priv?.status(), "unpublished storefront must 404, not 403").toBe(404);

      await setPublished(page, true);

      const live = await anonPage.goto(`/s/${slug}`);
      expect(live?.status()).toBe(200);
      await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(anonPage.getByText("Special Chai")).toBeVisible();
      await expect(anonPage.getByText(/₹\s*20/)).toBeVisible();

      // Unpublishing takes it straight back out of public view.
      await setPublished(page, false);
      const gone = await anonPage.goto(`/s/${slug}`);
      expect(gone?.status()).toBe(404);
    } finally {
      await anon.close();
    }
  });

  test("never exposes the vendor's phone or email", async ({ page, request, browser }) => {
    await createVendorSession(page, request, "storefront-pii", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Aloo Samosa", priceInRupees: 15 });
    await setPublished(page, true);

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const anonPage = await anon.newPage();
    try {
      await anonPage.goto(`/s/${slug}`);
      const html = await anonPage.content();
      // registerVendor() seeds this phone; the email is the login identity.
      expect(html).not.toContain("9876543210");
      expect(html).not.toContain("@example.com");
    } finally {
      await anon.close();
    }
  });

  test("an unknown slug 404s", async ({ page }) => {
    const res = await page.goto("/s/no-such-stall-abcxyz");
    expect(res?.status()).toBe(404);
  });
});
