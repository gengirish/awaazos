import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * A drop that is still open but fully sold out must not keep selling itself:
 * no "Pre-order · closes …" CTA, no countdown, and an item that is also on the
 * orderable everyday menu points the buyer there instead of dead-ending.
 * Along the way: a drop cart and a menu cart share one page-level cart bar
 * (two labelled checkouts), and the order page points back at the cart left
 * behind.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

test("drop + menu carts share one bar; a sold-out drop hands the buyer to the menu", async ({ page, request, browser }) => {
  test.setTimeout(240_000);

  const suffix = Math.random().toString(36).slice(2, 7);
  const bhel = `Lays Bhel ${suffix}`;
  const dropTitle = `Sunday cooking ${suffix}`;

  // ── Vendor: one item, published, pay on delivery, menu ordering on ──
  await createVendorSession(page, request, "soldout", "/menu");
  const slug = await vendorSlug(page);
  await createMenuItem(page, { name: bhel, priceInRupees: 5, category: "Snacks" });

  await page.goto("/settings/store");
  const publish = page.getByRole("switch", { name: /publish/i });
  if ((await publish.getAttribute("aria-checked")) !== "true") await publish.click();
  await expect(publish).toHaveAttribute("aria-checked", "true");

  await page.goto("/settings/payments");
  const payOnDelivery = page.getByRole("switch", { name: /pay on delivery/i });
  if ((await payOnDelivery.getAttribute("aria-checked")) !== "true") await payOnDelivery.click();
  await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");

  await page.goto("/settings/orders");
  const menuSwitch = page.getByRole("switch", { name: /order from your menu/i });
  if ((await menuSwitch.getAttribute("aria-checked")) !== "true") await menuSwitch.click();
  await expect(menuSwitch).toHaveAttribute("aria-checked", "true");

  // ── Vendor: a drop with exactly one to sell ─────────────────────────
  await page.goto("/drops/new");
  await expect(page.getByRole("heading", { name: "New drop" })).toBeVisible();
  await page.getByLabel("Title").fill(dropTitle);
  await page.getByRole("radio", { name: "Both" }).click();
  // Drops hide the everyday menu by default; this test is about the hand-off to it.
  await page.getByRole("checkbox", { name: /also show my everyday menu/i }).check();
  await page.getByRole("checkbox", { name: new RegExp(bhel) }).check();
  await page.getByRole("listitem").filter({ hasText: bhel }).getByLabel("How many can you make?").fill("1");
  await page.getByRole("button", { name: "Create drop" }).click();
  await page.waitForURL(/\/drops\/[^/]+\/edit$/, { timeout: 120_000 });
  await page.getByRole("button", { name: "Open orders" }).click();
  await expect(
    page.getByRole("region", { name: "Status" }).getByText("Taking orders", { exact: true }),
  ).toBeVisible();

  const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const buyer = await buyerCtx.newPage();
    await buyer.goto(`/s/${slug}`);

    // Before selling out: the drop drives the CTA, and prices drop the ".00".
    await expect(buyer.getByRole("link", { name: /^Pre-order · closes / })).toBeVisible();
    await expect(buyer.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Pre-order" })).toBeVisible();
    const drop = buyer.getByRole("region", { name: dropTitle });
    await expect(drop.getByText("₹5", { exact: true })).toBeVisible();
    // Empty cart takes no space and offers no Checkout button.
    await expect(buyer.getByRole("button", { name: "Checkout" })).toHaveCount(0);

    // ── Buyer: one cart in the drop, one in the everyday menu ─────────
    const menuRow = buyer.locator('[id^="menu-item-"]').filter({ hasText: bhel });
    await drop.getByRole("button", { name: `Add ${bhel}` }).click();
    await expect(buyer.getByRole("button", { name: "Checkout", exact: true })).toBeVisible();
    await menuRow.getByRole("button", { name: `Add ${bhel}` }).click();
    // Two carts → one page-level bar, one labelled row and Checkout per order.
    await expect(buyer.getByText("2 separate orders", { exact: true })).toBeVisible();
    await expect(buyer.getByRole("button", { name: "Checkout Everyday items" })).toBeVisible();

    // Take the only pre-order one.
    await buyer.getByRole("button", { name: `Checkout Pre-order · ${dropTitle}` }).click();
    const sheet = buyer.getByRole("dialog", { name: "Checkout" });
    await sheet.getByLabel("Your name").fill("Priya Buyer");
    await sheet.getByLabel("Mobile number").fill("98480 12345");
    await sheet.getByRole("radio", { name: "Pickup" }).check();
    await sheet.getByRole("radio", { name: /pay on delivery/i }).check();
    await sheet.getByRole("button", { name: /place order/i }).click();
    await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
    // The menu cart was left behind — the order page says so.
    await expect(buyer.getByRole("link", { name: /still have items in another cart/i })).toBeVisible();

    // ── Buyer: the sold-out drop no longer sells itself ───────────────
    await buyer.goto(`/s/${slug}`);
    const soldOutDrop = buyer.getByRole("region", { name: dropTitle });
    await expect(soldOutDrop.getByText("Sold out", { exact: true }).first()).toBeVisible();
    await expect(soldOutDrop.getByText(/^Order by/)).toHaveCount(0);
    await expect(buyer.getByRole("link", { name: /^Pre-order · closes / })).toHaveCount(0);
    await expect(buyer.getByRole("link", { name: "Order now" })).toBeVisible();
    // The left-behind menu cart is restored as the only cart.
    await expect(buyer.getByRole("button", { name: "Checkout", exact: true })).toBeVisible();

    // The sold-out item points at its everyday-menu row (already 1 in the cart).
    await soldOutDrop.getByRole("link", { name: `${bhel} is in everyday items` }).click();
    await expect(buyer).toHaveURL(/#menu-item-/);
    await expect(buyer.locator(":target")).toContainText(bhel);
    await expect(buyer.locator(":target").getByRole("button", { name: `Add one more ${bhel}` })).toBeVisible();
  } finally {
    await buyerCtx.close();
  }
});
