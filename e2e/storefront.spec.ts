import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The public storefront is the only unauthenticated read of tenant data, so
 * these tests are as much about what does NOT render as what does.
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

async function setPublished(page: Page, publishStorefront: boolean): Promise<void> {
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

  test("Share hands over the canonical store link", async ({ page, request, browser }) => {
    await createVendorSession(page, request, "storefront-share", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Share Chai", priceInRupees: 20, category: "Drinks" });
    await setPublished(page, true);

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    // Deterministic across platforms: no native share sheet, recorded clipboard.
    await anon.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      const w = window as unknown as { __copied?: string };
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void (w.__copied = t) },
        configurable: true,
      });
    });
    const anonPage = await anon.newPage();
    try {
      await anonPage.goto(`/s/${slug}#menu`);
      await anonPage.getByRole("button", { name: "Share" }).click();
      await expect(anonPage.getByRole("button", { name: "Link copied" })).toBeVisible();
      const copied = await anonPage.evaluate(() => (window as unknown as { __copied?: string }).__copied);
      expect(copied).toBe(new URL(`/s/${slug}`, anonPage.url()).toString());
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

  test("unavailable items are withheld from the public page", async ({
    page,
    request,
    browser,
  }) => {
    await createVendorSession(page, request, "storefront-avail", "/menu");
    const slug = await vendorSlug(page);
    const sold = await createMenuItem(page, { name: "Sold Out Jalebi", priceInRupees: 40 });
    await createMenuItem(page, { name: "In Stock Poha", priceInRupees: 25 });

    const patch = await page.request.patch(`/api/menu/${sold.id}`, {
      data: { isAvailable: false },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.ok(), "marking an item unavailable").toBe(true);

    await setPublished(page, true);

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const anonPage = await anon.newPage();
    try {
      await anonPage.goto(`/s/${slug}`);
      await expect(anonPage.getByText("In Stock Poha")).toBeVisible();
      // A customer must not be able to order what the stall has run out of,
      // and the item name should not leak onto the page at all.
      await expect(anonPage.getByText("Sold Out Jalebi")).toHaveCount(0);
    } finally {
      await anon.close();
    }
  });

  test("the UPI QR appears only once the vendor has a UPI ID", async ({
    page,
    request,
    browser,
  }) => {
    await createVendorSession(page, request, "storefront-upi", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Cutting Chai", priceInRupees: 10 });
    await setPublished(page, true);

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const anonPage = await anon.newPage();

    try {
      // register() does not set a UPI ID, so the pay block must be absent
      // rather than rendering a QR that resolves to nobody.
      await anonPage.goto(`/s/${slug}`);
      await expect(anonPage.getByRole("heading", { name: /scan to pay/i })).toHaveCount(0);

      const patch = await page.request.patch("/api/vendor", {
        data: { upiId: "e2e-stall@okaxis", upiName: "E2E Stall" },
        headers: { "Content-Type": "application/json" },
      });
      expect(patch.ok(), "saving a UPI ID").toBe(true);

      await anonPage.goto(`/s/${slug}`);
      await expect(anonPage.getByRole("heading", { name: /scan to pay/i })).toBeVisible();
      await expect(anonPage.getByRole("img", { name: /UPI QR code/i })).toBeVisible();
    } finally {
      await anon.close();
    }
  });

  test("an owner can publish from the Settings UI, not just the API", async ({
    page,
    request,
    browser,
  }) => {
    await createVendorSession(page, request, "storefront-ui", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Misal Pav", priceInRupees: 60 });

    await page.goto("/settings/store");
    const toggle = page.getByRole("switch", { name: /publish/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // The link only appears once published — it is the thing the vendor shares.
    await expect(page.getByText(`/s/${slug}`)).toBeVisible();

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const anonPage = await anon.newPage();
    try {
      const res = await anonPage.goto(`/s/${slug}`);
      expect(res?.status(), "the UI toggle must actually publish").toBe(200);
      await expect(anonPage.getByText("Misal Pav")).toBeVisible();
    } finally {
      await anon.close();
    }
  });

  test("the POS gear reaches Settings, so the storefront control is discoverable", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "storefront-nav", "/menu");
    await createMenuItem(page, { name: "Idli", priceInRupees: 30 });

    await page.goto("/pos");
    await page.getByRole("link", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("link", { name: /Online store/ }).first().click();
    await expect(page).toHaveURL(/\/settings\/store$/);
    await expect(page.getByRole("switch", { name: /publish/i })).toBeVisible();
  });
});
