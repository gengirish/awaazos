import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * "Order from menu": a stall switches on menu ordering, a guest buyer orders
 * straight from the everyday menu (no drop), and the vendor collects it from
 * the Online orders board.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

async function stubQrService(page: Page): Promise<void> {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**://api.qrserver.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng }),
  );
}

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

test.describe("menu orders: order straight from the everyday menu", () => {
  test("vendor enables menu ordering, guest orders, vendor collects on the board", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);

    const suffix = Math.random().toString(36).slice(2, 7);
    const bhel = `Lays Bhel ${suffix}`;
    const panna = `Aam Panna ${suffix}`;

    // ── Vendor: register, menu ─────────────────────────────────────────
    await createVendorSession(page, request, "menuorders", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: bhel, priceInRupees: 75, category: "Snacks" });
    await createMenuItem(page, { name: panna, priceInRupees: 50, category: "Beverages" });

    // Before opting in, the storefront menu is display-only.
    const before = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const p = await before.newPage();
      await stubQrService(p);
      await page.goto("/settings");
      const publish = page.getByRole("switch", { name: /publish/i });
      if ((await publish.getAttribute("aria-checked")) !== "true") await publish.click();
      await expect(publish).toHaveAttribute("aria-checked", "true");
      await p.goto(`/s/${slug}`);
      await expect(p.getByText(bhel)).toBeVisible();
      await expect(p.getByRole("button", { name: `Add ${bhel}` })).toHaveCount(0);
    } finally {
      await before.close();
    }

    // ── Vendor: turn on menu ordering (needs a payment method) ─────────
    const menuSwitch = page.getByRole("switch", { name: /order from your menu/i });
    const payOnDelivery = page.getByRole("switch", { name: /pay on delivery/i });
    if ((await payOnDelivery.getAttribute("aria-checked")) !== "true") await payOnDelivery.click();
    await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");
    await menuSwitch.click();
    await expect(menuSwitch).toHaveAttribute("aria-checked", "true");

    // ── Buyer: guest orders from the menu ──────────────────────────────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await stubQrService(buyer);
      const res = await buyer.goto(`/s/${slug}`);
      expect(res?.status()).toBe(200);

      await buyer.getByRole("button", { name: `Add ${bhel}` }).click();
      await buyer.getByRole("button", { name: `Add one more ${bhel}` }).click();
      await buyer.getByRole("button", { name: `Add ${panna}` }).click();

      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();
      await sheet.getByLabel("Your name").fill("Ravi Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      // Default menu fulfilment is pickup-only, so there is no delivery choice to make.
      await sheet.getByRole("radio", { name: /pay on delivery/i }).check();
      await sheet.getByRole("button", { name: /place order · ₹200\.00/i }).click();

      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      await expect(buyer.getByText("Pay on delivery").first()).toBeVisible();
      await expect(buyer.getByText(bhel).first()).toBeVisible();
    } finally {
      await buyerCtx.close();
    }

    // ── Vendor: Online orders board ────────────────────────────────────
    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "Online orders" })).toBeVisible();
    await expect(page.getByText("Ravi Buyer").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "To make" })).toBeVisible();

    const card = page.getByRole("article", { name: /Ravi Buyer/ });
    await expect(card.getByText(`2 × ${bhel}`)).toBeVisible();
    await card.getByRole("button", { name: "Confirm" }).click();

    // Confirming moves the order to the Confirmed tab; follow it there.
    await page.getByRole("tab", { name: /^Confirmed/ }).click();
    const confirmed = page.getByRole("article", { name: /Ravi Buyer/ });
    await confirmed.getByRole("button", { name: /picked up · ₹200\.00 collected/i }).click();

    await page.getByRole("tab", { name: /^Delivered/ }).click();
    const delivered = page.getByRole("article", { name: /Ravi Buyer/ });
    await expect(delivered.getByText("Delivered", { exact: true })).toBeVisible();
    // Cash collected at handover marks it paid.
    await expect(page.getByRole("listitem").filter({ hasText: /^Paid/ })).toContainText("₹200.00");
  });
});
