import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, addRatedOrders } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * A buyer rates a handed-over order; the seller sees the stars and the comment,
 * the public store sees neither until it has 5 ratings, and then only the
 * average. Writes rows — throwaway DB only (see CLAUDE.md).
 */

test.describe("order feedback", () => {
  test("rate once after handover; private comment; public average from 5 ratings", async ({
    page,
    request,
    browser,
  }) => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to add ratings");
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const dish = `Bhel ${suffix}`;
    const comment = `Lovely and fresh ${suffix}`;

    // ── Vendor: one item, pay on delivery, menu ordering ───────────────
    await createVendorSession(page, request, "feedback", "/menu");
    await createMenuItem(page, { name: dish, priceInRupees: 75, category: "Snacks" });
    const { id: vendorId, slug } = await openStoreForMenuOrders(page);

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      // ── Buyer orders ─────────────────────────────────────────────────
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}`);
      await buyer.getByRole("button", { name: `Add ${dish}` }).click();
      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await sheet.getByLabel("Your name").fill("Ravi Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("button", { name: /place order/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      const orderPath = new URL(buyer.url()).pathname;
      const feedbackUrl = `/api/s/${slug}/orders/${orderPath.split("/").pop()}/feedback`;

      // ── Not before it is handed over ─────────────────────────────────
      await expect(buyer.getByRole("heading", { name: "How was your order?" })).toHaveCount(0);
      const early = await buyer.request.post(feedbackUrl, { data: { rating: 5 } });
      expect(early.status()).toBe(409);

      // ── Seller hands it over ─────────────────────────────────────────
      await page.goto("/orders");
      await page.getByRole("article", { name: /Ravi Buyer/ }).getByRole("button", { name: "Confirm" }).click();
      await page.getByRole("tab", { name: /^Confirmed/ }).click();
      await page
        .getByRole("article", { name: /Ravi Buyer/ })
        .getByRole("button", { name: /picked up · ₹75\.00 collected/i })
        .click();
      await page.getByRole("tab", { name: /^Delivered/ }).click();
      await expect(page.getByRole("article", { name: /Ravi Buyer/ })).toBeVisible();

      // ── Buyer rates: stars are required, then it is once only ────────
      await buyer.goto(orderPath);
      await buyer.getByRole("button", { name: "Send feedback" }).click();
      await expect(buyer.getByText("Choose a rating first.")).toBeVisible();
      await buyer.getByRole("radio", { name: "4 out of 5: Very good" }).check();
      await expect(buyer.getByText("Choose a rating first.")).toHaveCount(0);
      await buyer.getByLabel(/anything to add/i).fill(comment);
      await buyer.getByRole("button", { name: "Send feedback" }).click();
      await expect(buyer.getByText(/You rated this 4 of 5/)).toBeVisible();
      await expect(buyer.getByRole("heading", { name: "How was your order?" })).toHaveCount(0);

      const again = await buyer.request.post(feedbackUrl, { data: { rating: 1 } });
      expect(again.status()).toBe(409);
      expect(((await again.json()) as { error: string }).error).toBe("already_rated");
      const bad = await buyer.request.post(feedbackUrl, { data: { rating: 6 } });
      expect(bad.status()).toBe(400);
      // A real token under another store's link is a miss, like any unknown order.
      const wrongStore = await buyer.request.post(feedbackUrl.replace(slug, `${slug}-other`), { data: { rating: 5 } });
      expect(wrongStore.status()).toBe(404);

      // ── Seller sees stars and comment, on the card and in Settings ───
      await page.reload();
      await page.getByRole("tab", { name: /^Delivered/ }).click();
      const card = page.getByRole("article", { name: /Ravi Buyer/ });
      await expect(card.getByText("Rated 4 of 5")).toBeVisible();
      await card.getByRole("button", { name: /show details/i }).click();
      await expect(card.getByText(comment)).toBeVisible();

      await page.goto("/settings/feedback");
      await expect(page.getByText(comment)).toBeVisible();
      await expect(page.getByText("4 to go", { exact: false })).toBeVisible();

      // ── The public store shows nothing with fewer than 5 ─────────────
      await buyer.goto(`/s/${slug}`);
      const about = buyer.getByRole("list", { name: "About this store" });
      await expect(about).not.toContainText("out of 5");
      await expect(buyer.locator("body")).not.toContainText(comment);

      // ── Four more ratings: the average appears, the comment still doesn't ──
      await addRatedOrders(vendorId, [5, 5, 5, 4]);
      await buyer.reload();
      await expect(about).toContainText("4.6 out of 5 · 5 ratings");
      await expect(buyer.locator("body")).not.toContainText(comment);

      await page.reload();
      await expect(page.getByText(/Your store page shows this average/)).toBeVisible();
    } finally {
      await buyerCtx.close();
    }
  });
});
