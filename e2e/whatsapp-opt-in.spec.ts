import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The vendor's WhatsApp number reaches buyers only after the vendor opts in
 * (`VendorSettings.acceptWhatsappOrders`, default off) — having a number saved
 * (onboarding pre-fills it) is not consent to publish it.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

async function patchVendor(page: Page, data: Record<string, unknown>) {
  return page.request.patch("/api/vendor", { data, headers: { "Content-Type": "application/json" } });
}

test.describe("WhatsApp orders opt-in", () => {
  test("number stays hidden until the owner turns WhatsApp orders on", async ({ page, request, browser }) => {
    test.setTimeout(240_000);

    const dish = `Pesarattu ${Math.random().toString(36).slice(2, 7)}`;
    await createVendorSession(page, request, "wa-optin", "/menu");
    const slug = ((await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } }).vendor.slug;
    await createMenuItem(page, { name: dish, priceInRupees: 60, category: "Tiffin" });

    // Clear any onboarding number so the "needs a number" guard is exercised.
    expect((await patchVendor(page, { whatsappNumber: null })).status()).toBe(200);
    for (const data of [{ publishStorefront: true }, { acceptPayOnDelivery: true }, { acceptMenuOrders: true }]) {
      expect((await patchVendor(page, data)).status(), JSON.stringify(data)).toBe(200);
    }

    // Opting in without a number is refused.
    const noNumber = await patchVendor(page, { acceptWhatsappOrders: true });
    expect(noNumber.status()).toBe(409);
    expect(((await noNumber.json()) as { error: string }).error).toBe("whatsapp_number_required");

    // A saved number alone is not an opt-in; it is stored in E.164.
    const saved = await patchVendor(page, { whatsappNumber: "98765 43210" });
    expect(saved.status()).toBe(200);
    const savedBody = (await saved.json()) as {
      vendor: { settings: { whatsappNumber: string | null; acceptWhatsappOrders: boolean } };
    };
    expect(savedBody.vendor.settings.whatsappNumber).toBe("+919876543210");
    expect(savedBody.vendor.settings.acceptWhatsappOrders).toBe(false);

    // ── Buyer orders while the opt-in is off ───────────────────────────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    let orderPath = "";
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}`);
      await buyer.getByRole("button", { name: `Add ${dish}` }).click();
      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await sheet.getByLabel("Your name").fill("Lakshmi Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("radio", { name: /pay on delivery/i }).check();
      await expect(sheet.getByRole("button", { name: /whatsapp/i })).toHaveCount(0);
      await sheet.getByRole("button", { name: /place order · ₹60\.00/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      orderPath = new URL(buyer.url()).pathname;

      const html = await buyer.content();
      expect(html).not.toContain("wa.me/");
      expect(html).not.toContain("9876543210");
    } finally {
      await buyerCtx.close();
    }

    // ── Owner opts in from Settings → Online orders ────────────────────
    await page.goto("/settings/orders");
    const toggle = page.getByRole("switch", { name: /send orders on whatsapp/i });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Customers who order will be able to see this phone number.")).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Same order page now offers the WhatsApp link.
    const after = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await after.newPage();
      await buyer.goto(orderPath);
      await expect(buyer.locator('a[href^="https://wa.me/919876543210"]').first()).toBeVisible();
    } finally {
      await after.close();
    }
  });

  test("store page shows WhatsApp and Instagram links only once the owner adds them", async ({ page, request, browser }) => {
    test.setTimeout(240_000);

    await createVendorSession(page, request, "store-handles", "/menu");
    const slug = ((await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } }).vendor.slug;
    await createMenuItem(page, { name: "Ragi laddu", priceInRupees: 40, category: "Sweets" });
    for (const data of [{ publishStorefront: true }, { whatsappNumber: "98765 43210" }, { acceptWhatsappOrders: true }]) {
      expect((await patchVendor(page, data)).status(), JSON.stringify(data)).toBe(200);
    }

    async function storeHtml() {
      const ctx = await browser.newContext(CONTEXT_OPTIONS);
      try {
        const buyer = await ctx.newPage();
        await buyer.goto(`/s/${slug}`);
        await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
        return await buyer.content();
      } finally {
        await ctx.close();
      }
    }

    // WhatsApp orders being on does not put the number on the store page.
    const before = await storeHtml();
    expect(before).not.toContain("wa.me/");
    expect(before).not.toContain("9876543210");
    expect(before).not.toContain("instagram.com/");

    // A handle that is not a username is refused; a pasted profile link is stored bare.
    const bad = await patchVendor(page, { instagramHandle: "https://evil.example/ammas" });
    expect(bad.status()).toBe(400);
    const good = await patchVendor(page, { instagramHandle: "https://www.instagram.com/Ammas.Kitchen/?hl=en" });
    expect(good.status()).toBe(200);
    expect(
      ((await good.json()) as { vendor: { settings: { instagramHandle: string | null } } }).vendor.settings.instagramHandle,
    ).toBe("ammas.kitchen");

    // ── Owner turns on the store-page WhatsApp button ──────────────────
    await page.goto("/settings/orders");
    const toggle = page.getByRole("switch", { name: /whatsapp button on your store page/i });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Anyone who opens your store page will be able to see this phone number.")).toBeVisible();
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      const contact = buyer.getByRole("list", { name: "Contact" });
      const wa = contact.locator('a[href^="https://wa.me/919876543210"]');
      const ig = contact.locator('a[href="https://www.instagram.com/ammas.kitchen/"]');
      await expect(wa).toBeVisible();
      await expect(ig).toHaveText(/@ammas\.kitchen/);
      for (const link of [wa, ig]) {
        expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
    } finally {
      await ctx.close();
    }

    // Clearing the handle and turning the button off removes both again.
    expect((await patchVendor(page, { instagramHandle: "", showWhatsappOnStore: false })).status()).toBe(200);
    const after = await storeHtml();
    expect(after).not.toContain("wa.me/");
    expect(after).not.toContain("instagram.com/");
  });

  test("the store-page WhatsApp button needs a saved number", async ({ page, request }) => {
    await createVendorSession(page, request, "store-wa-guard", "/menu");
    expect((await patchVendor(page, { whatsappNumber: null })).status()).toBe(200);
    const res = await patchVendor(page, { showWhatsappOnStore: true });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("whatsapp_number_required");
  });
});
