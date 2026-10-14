import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Buyer order page, UPI pay block on iPhone vs Android.
 *
 * iOS has no chooser for `upi://`, so the page re-orders after mount to lead
 * with per-app buttons (Google Pay / PhonePe / Paytm) built from the same UPI
 * params, keeps the generic link as "Other UPI app", and offers copy-UPI-ID /
 * copy-amount. Android keeps the generic button and gets no app buttons.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UPI_ID = "e2e-upi-pay@okaxis";

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

/** Guest buyer orders one item by UPI and lands on the order page. */
async function placeUpiOrder(buyer: Page, slug: string, itemName: string): Promise<void> {
  const res = await buyer.goto(`/s/${slug}`);
  expect(res?.status()).toBe(200);
  await buyer.getByRole("button", { name: `Add ${itemName}` }).click();
  await buyer.getByRole("button", { name: "Checkout" }).click();
  const sheet = buyer.getByRole("dialog", { name: "Checkout" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Your name").fill("Upi Buyer");
  await sheet.getByLabel("Mobile number").fill("98480 54321");
  await sheet.getByRole("radio", { name: /pay now by upi/i }).check();
  await sheet.getByRole("button", { name: /place order · ₹120\.00/i }).click();
  await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
  await expect(buyer.getByRole("heading", { name: /pay ₹120\.00/i })).toBeVisible();
}

test.describe("storefront order page: UPI pay options per platform", () => {
  test("iPhone gets per-app UPI buttons and copy fallbacks; Android keeps the generic link", async ({
    page,
    request,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only in Playwright");
    test.setTimeout(240_000);

    const item = `Ragi Laddu ${Math.random().toString(36).slice(2, 7)}`;

    // ── Vendor: UPI ID, menu, publish, menu ordering ──────────────────
    await createVendorSession(page, request, "upipay", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: item, priceInRupees: 120, category: "Sweets" });
    const patch = await page.request.patch("/api/vendor", {
      data: { upiId: UPI_ID, upiName: "E2E Kitchen" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.ok(), "saving a UPI ID").toBe(true);

    await page.goto("/settings/store");
    const publish = page.getByRole("switch", { name: /publish/i });
    if ((await publish.getAttribute("aria-checked")) !== "true") await publish.click();
    await expect(publish).toHaveAttribute("aria-checked", "true");
    await page.goto("/settings/orders");
    const menuSwitch = page.getByRole("switch", { name: /order from your menu/i });
    if ((await menuSwitch.getAttribute("aria-checked")) !== "true") await menuSwitch.click();
    await expect(menuSwitch).toHaveAttribute("aria-checked", "true");

    // ── iPhone buyer ──────────────────────────────────────────────────
    const ios = await browser.newContext({
      ...CONTEXT_OPTIONS,
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    try {
      const buyer = await ios.newPage();
      await placeUpiOrder(buyer, slug, item);

      const gpay = buyer.getByRole("link", { name: "Pay ₹120.00 with Google Pay" });
      const phonepe = buyer.getByRole("link", { name: "Pay ₹120.00 with PhonePe" });
      const paytm = buyer.getByRole("link", { name: "Pay ₹120.00 with Paytm" });
      await expect(gpay).toHaveAttribute("href", /^tez:\/\/upi\/pay\?/);
      await expect(phonepe).toHaveAttribute("href", /^phonepe:\/\/pay\?/);
      await expect(paytm).toHaveAttribute("href", /^paytmmp:\/\/upi\/pay\?/);
      const href = (await gpay.getAttribute("href")) ?? "";
      const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      expect(params.get("pa")).toBe(UPI_ID);
      expect(params.get("am")).toBe("120.00");
      expect(params.get("cu")).toBe("INR");

      // Generic link is still there, demoted.
      await expect(buyer.getByRole("link", { name: "Other UPI app" })).toHaveAttribute("href", /^upi:\/\/pay\?/);

      for (const link of [gpay, phonepe, paytm]) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }

      await buyer.getByRole("button", { name: "Copy UPI ID" }).click();
      await expect(buyer.getByRole("status").filter({ hasText: "UPI ID copied" })).toBeAttached();
      expect(await buyer.evaluate(() => navigator.clipboard.readText())).toBe(UPI_ID);

      await buyer.getByRole("button", { name: "Copy amount" }).click();
      await expect(buyer.getByRole("status").filter({ hasText: "Amount ₹120.00 copied" })).toBeAttached();
      expect(await buyer.evaluate(() => navigator.clipboard.readText())).toBe("120");

      await expect(buyer.getByText(/Open any UPI app → Pay to UPI ID → paste/)).toBeVisible();
      // The QR is for a second phone, so it waits behind a disclosure.
      const qr = buyer.getByRole("img", { name: /UPI QR code to pay ₹120\.00/ });
      await expect(qr).toBeHidden();
      await buyer.getByText("Paying from another phone? Show QR").click();
      await expect(qr).toBeVisible();
    } finally {
      await ios.close();
    }

    // ── Android buyer ─────────────────────────────────────────────────
    const android = await browser.newContext({
      ...CONTEXT_OPTIONS,
      userAgent: ANDROID_UA,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    try {
      const buyer = await android.newPage();
      await placeUpiOrder(buyer, slug, item);
      await expect(buyer.getByRole("link", { name: "Pay ₹120.00 with a UPI app" })).toHaveAttribute(
        "href",
        /^upi:\/\/pay\?/,
      );
      await expect(buyer.getByRole("link", { name: /with Google Pay/ })).toHaveCount(0);
      await expect(buyer.getByRole("button", { name: "Copy UPI ID" })).toBeVisible();
    } finally {
      await android.close();
    }
  });
});
