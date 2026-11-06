import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * "Add <store> to your Home Screen" (lib/store-app.ts, components/storefront/StoreInstall.tsx).
 *
 * The store page installs as the store's own app, not the seller app: its own
 * manifest link, scope and icons, behind the same publish gate as the page.
 * Playwright's Chromium never offers a real install, so `beforeinstallprompt`
 * is a stand-in event (as in install-prompt.spec.ts).
 *
 * Writes rows — throwaway DB only (see CLAUDE.md).
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { vendor: { slug: string } }).vendor.slug;
}

async function setPublished(page: Page, publishStorefront: boolean): Promise<void> {
  const res = await page.request.patch("/api/vendor", {
    data: { publishStorefront },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok()).toBe(true);
}

test.describe("store app install", () => {
  test("a published store links its own manifest and icons; an unpublished one serves neither", async ({
    page,
    request,
    browser,
  }) => {
    const creds = await createVendorSession(page, request, "store-app", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Ragi Laddu", priceInRupees: 40 });

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const buyer = await anon.newPage();
    try {
      expect((await buyer.request.get(`/s/${slug}/manifest.webmanifest`)).status()).toBe(404);
      expect((await buyer.request.get(`/s/${slug}/app-icon/192`)).status()).toBe(404);

      await setPublished(page, true);
      await buyer.goto(`/s/${slug}`);

      // One manifest link, the store's, in place of the seller app's.
      const links = buyer.locator('link[rel="manifest"]');
      await expect(links).toHaveCount(1);
      await expect(links).toHaveAttribute("href", `/s/${slug}/manifest.webmanifest`);
      await expect(buyer.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", creds.stallName);

      const res = await buyer.request.get(`/s/${slug}/manifest.webmanifest`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/manifest+json");
      const manifest = (await res.json()) as Record<string, unknown> & { icons: { src: string }[] };
      expect(manifest).toMatchObject({ id: `/s/${slug}`, start_url: `/s/${slug}`, scope: `/s/${slug}`, name: creds.stallName });
      expect(JSON.stringify(manifest)).not.toContain("@"); // no email, nothing about the owner

      const icon = await buyer.request.get(manifest.icons[0].src);
      expect(icon.status()).toBe(200);
      expect(icon.headers()["content-type"]).toBe("image/png");
      expect((await buyer.request.get(`/s/${slug}/app-icon/64`)).status()).toBe(404);
    } finally {
      await anon.close();
    }
  });

  test("an offered install shows the card; tapping it prompts once, and closing it sticks", async ({
    page,
    request,
    browser,
  }) => {
    const creds = await createVendorSession(page, request, "store-app-tap", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: "Banana Bread", priceInRupees: 120 });
    await setPublished(page, true);

    const anon = await browser.newContext(CONTEXT_OPTIONS);
    const buyer = await anon.newPage();
    try {
      const card = buyer.getByTestId("store-install");
      const offer = async () => {
        await expect(async () => {
          await buyer.evaluate(() => {
            const w = window as unknown as { __installPrompts?: number };
            const event = new Event("beforeinstallprompt", { cancelable: true });
            Object.assign(event, {
              prompt: () => {
                w.__installPrompts = (w.__installPrompts ?? 0) + 1;
                return Promise.resolve();
              },
              userChoice: Promise.resolve({ outcome: "dismissed" }),
            });
            window.dispatchEvent(event);
          });
          await expect(card).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
      };

      await buyer.goto(`/s/${slug}`);
      await offer();
      await expect(card).toContainText(`Add ${creds.stallName} to your Home Screen`);
      await card.getByRole("button", { name: "Add to Home Screen", exact: true }).click();
      await expect
        .poll(() => buyer.evaluate(() => (window as unknown as { __installPrompts?: number }).__installPrompts ?? 0))
        .toBe(1);
      // The browser's prompt is single-use: the card goes until it offers again.
      await expect(card).toHaveCount(0);

      await buyer.reload();
      await offer();
      await card.getByRole("button", { name: "Close the Home Screen tip" }).click();
      await expect(card).toHaveCount(0);
      expect(
        await buyer.evaluate((key) => window.localStorage.getItem(key), `awz_store_install_dismissed_v1:${slug}`),
      ).toBe("1");
    } finally {
      await anon.close();
    }
  });
});
