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
});
