import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * A free-item plan ("2+ candles → free bracelet", lib/offers.ts) seen end to end:
 * the buyer's cart shows the gift, the order adds it at ₹0 without changing the
 * total, and the seller's "To make" counts it on the item's own row with
 * "(1 free)", so the gift is made with the paid ones instead of forgotten.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

test.describe("free gift on the orders board", () => {
  test("the gift is in the cart, free on the order, and counted in To make", async ({ page, request, browser }) => {
    test.setTimeout(240_000);

    await createVendorSession(page, request, "gift", "/orders");
    const suffix = Math.random().toString(36).slice(2, 7);
    const candle = await createMenuItem(page, { name: `Soy Candle ${suffix}`, priceInRupees: 200, category: "Candles" });
    const bracelet = await createMenuItem(page, { name: `Evil Eye Bracelet ${suffix}`, priceInRupees: 100, category: "Gifts" });

    const offer = await page.request.post("/api/offers", {
      data: {
        name: "Candle gift",
        eligibility: "ITEMS",
        eligibleItemIds: [candle.id],
        minQty: 2,
        discountType: "FREE_ITEM",
        freeItemId: bracelet.id,
        freeItemQty: 1,
        onPos: false,
      },
      headers: JSON_HEADERS,
    });
    expect(offer.status(), await offer.text()).toBe(201);

    const settings = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true, acceptPayOnDelivery: true },
      headers: JSON_HEADERS,
    });
    expect(settings.status()).toBe(200);
    expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: true } })).status()).toBe(200);
    const { vendor } = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };

    // ── Buyer: 2 candles + 1 bracelet they pay for; the plan adds a free one ─
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${vendor.slug}`);
      await buyer.getByRole("button", { name: `Add ${candle.name}` }).click();
      await buyer.getByRole("button", { name: `Add ${bracelet.name}` }).click();
      await buyer.getByRole("button", { name: "Checkout", exact: true }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();

      // One candle is below the minimum: no gift yet.
      await expect(sheet.getByText(`${bracelet.name} (free gift)`)).toHaveCount(0);
      await sheet.getByRole("list", { name: "Items in your cart" }).getByRole("button", { name: `Add one more ${candle.name}` }).click();
      await expect(sheet.getByText(`${bracelet.name} (free gift)`).first()).toBeVisible();

      // The gift takes nothing off: 2 × ₹200 + ₹100.
      await sheet.getByLabel("Your name").fill("Pooja Gift");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("button", { name: /place order(?: & pay)? · ₹500\.00/i }).click();

      await buyer.waitForURL(new RegExp(`/s/${vendor.slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      const giftLine = buyer.getByRole("listitem").filter({ hasText: `${bracelet.name} (free gift)` });
      await expect(giftLine).toContainText("Free");
    } finally {
      await buyerCtx.close();
    }

    // ── Seller: the card lists the gift; To make counts it with the paid one ─
    await page.goto("/orders");
    const card = page.getByRole("article", { name: /Pooja Gift/ });
    await expect(card.getByText(`${bracelet.name} (free gift)`, { exact: false })).toBeVisible();
    await expect(card).toContainText("₹500.00");

    const toMake = page.getByRole("list", { name: "Items to make" });
    await expect(toMake.getByRole("listitem").filter({ hasText: candle.name })).toHaveText(/^2 ×\s*Soy Candle/);
    // One row per item: the paid bracelet and the gift, not a separate "(free gift)" row.
    const braceletRow = toMake.getByRole("listitem").filter({ hasText: bracelet.name });
    await expect(braceletRow).toHaveCount(1);
    await expect(braceletRow).toContainText("2 ×");
    await expect(braceletRow).toContainText("(1 free)");
    await expect(braceletRow).not.toContainText("free gift");
  });
});
