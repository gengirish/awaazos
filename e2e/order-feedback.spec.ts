import { expect, test } from "@playwright/test";

import { prisma } from "../lib/prisma";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

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
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const dish = `Bhel ${suffix}`;
    const comment = `Lovely and fresh ${suffix}`;

    // ── Vendor: one item, pay on delivery, menu ordering ───────────────
    await createVendorSession(page, request, "feedback", "/menu");
    const vendorRes = await page.request.get("/api/vendor");
    const { id: vendorId, slug } = ((await vendorRes.json()) as { vendor: { id: string; slug: string } }).vendor;
    await createMenuItem(page, { name: dish, priceInRupees: 75, category: "Snacks" });
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
    await menuSwitch.click();
    await expect(menuSwitch).toHaveAttribute("aria-checked", "true");

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
      const order = await prisma.transaction.findFirstOrThrow({
        where: { vendorId, orderToken: orderPath.split("/").pop() },
      });
      for (const [i, rating] of [5, 5, 5, 4].entries()) {
        const copy = await prisma.transaction.create({
          data: {
            vendorId,
            billNumber: `${order.billNumber}-${i}`,
            subtotalPaise: order.subtotalPaise,
            totalPaise: order.totalPaise,
            paymentMethod: order.paymentMethod,
            source: "STOREFRONT",
            fulfilmentStatus: "DELIVERED",
          },
          select: { id: true },
        });
        await prisma.orderFeedback.create({ data: { vendorId, transactionId: copy.id, rating } });
      }
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
