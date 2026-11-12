import { expect, test } from "@playwright/test";

import { createLoginToken } from "../lib/customer-auth";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * After an order is over the buyer can fill the cart from it, on the order page
 * and in their history, and the seller's WhatsApp text follows the order. Writes
 * rows — throwaway DB only (see CLAUDE.md).
 */

test.describe("order again", () => {
  test("seller messages follow the order; the buyer reorders what is still sold", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const kept = `Bhel ${suffix}`;
    const gone = `Panna ${suffix}`;

    // ── Vendor: two items, pay on delivery, menu ordering ──────────────
    await createVendorSession(page, request, "orderagain", "/menu");
    await createMenuItem(page, { name: kept, priceInRupees: 75, category: "Snacks" });
    await createMenuItem(page, { name: gone, priceInRupees: 50, category: "Drinks" });
    const { slug } = await openStoreForMenuOrders(page);

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      // ── Signed-in buyer orders both ──────────────────────────────────
      const buyer = await buyerCtx.newPage();
      const { rawToken } = await createLoginToken(`again-${suffix}@example.com`, `/s/${slug}`);
      await buyer.goto(`/api/s/customer/verify?token=${encodeURIComponent(rawToken)}`);
      await buyer.waitForURL(new RegExp(`/s/${slug}$`));
      await buyer.getByRole("button", { name: `Add ${kept}` }).click();
      await buyer.getByRole("button", { name: `Add one more ${kept}` }).click();
      await buyer.getByRole("button", { name: `Add ${gone}` }).click();
      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await sheet.getByLabel("Your name").fill("Ravi Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("button", { name: /place order(?: & pay)? · ₹200\.00/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      const orderPath = new URL(buyer.url()).pathname;

      // A live order offers no way to order it again.
      await expect(buyer.getByRole("button", { name: /order again/i })).toHaveCount(0);

      // ── Seller: the WhatsApp text follows the order ──────────────────
      await page.goto("/orders");
      const card = page.getByRole("article", { name: /Ravi Buyer/ });
      await expect(card.getByRole("link", { name: "WhatsApp Ravi Buyer" })).toHaveAttribute(
        "href",
        /^https:\/\/wa\.me\/919848054321\?text=Hi%20Ravi%2C%20about%20your%20order/,
      );
      await card.getByRole("button", { name: "Accept order" }).click();
      await page.getByRole("tab", { name: /^Preparing/ }).click();
      const confirmed = page.getByRole("article", { name: /Ravi Buyer/ });
      await confirmed.getByRole("button", { name: /show details/i }).click();
      // The order link joins the text just after the card mounts, so wait for it.
      const update = confirmed.getByRole("link", { name: "WhatsApp Ravi Buyer" });
      const messageIn = async (link: typeof update) =>
        new URL((await link.getAttribute("href")) ?? "").searchParams.get("text") ?? "";
      await expect.poll(() => messageIn(update)).toContain(orderPath);
      expect(await messageIn(update)).toContain("is confirmed.");
      const ready = confirmed.getByRole("link", { name: /ready for pickup/i });
      expect(await messageIn(ready)).toContain("is ready for pickup.");
      await confirmed.getByRole("button", { name: "Mark ready" }).click();
      await page.getByRole("tab", { name: /^Ready/ }).click();
      await confirmed.getByRole("button", { name: /picked up · ₹200\.00 collected/i }).click();
      await page.getByRole("tab", { name: /^Done/ }).click();
      await expect(page.getByRole("article", { name: /Ravi Buyer/ }).getByText("Picked up", { exact: true })).toBeVisible();

      // ── One item is no longer sold ───────────────────────────────────
      const menu = (await (await page.request.get("/api/menu")).json()) as { data: { id: string; name: string }[] };
      const goneId = menu.data.find((i) => i.name === gone)?.id;
      const off = await page.request.patch(`/api/menu/${goneId}`, {
        data: { isAvailable: false },
        headers: { "Content-Type": "application/json" },
      });
      expect(off.ok(), "marking an item unavailable").toBe(true);

      // ── Buyer: history names the items; order again fills the cart ───
      await buyer.goto(`/s/${slug}/account`);
      await expect(buyer.getByText(`2 × ${kept}, 1 × ${gone}`)).toBeVisible();
      await expect(buyer.getByText(`Not available now: ${gone}`)).toBeVisible();

      await buyer.goto(orderPath);
      await expect(buyer.getByText(`Not available now: ${gone}`)).toBeVisible();
      await buyer.getByRole("button", { name: /order again/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${slug}#menu-order$`));

      await buyer.getByRole("button", { name: "Checkout" }).click();
      const again = buyer.getByRole("dialog", { name: "Checkout" });
      const cart = again.getByRole("list", { name: "Items in your cart" });
      await expect(cart.getByText(kept)).toBeVisible();
      await expect(cart.getByText(gone)).toHaveCount(0);
      // Priced by today's menu: 2 × ₹75.
      await expect(again.getByRole("button", { name: /place order(?: & pay)? · ₹150\.00/i })).toBeVisible();
    } finally {
      await buyerCtx.close();
    }
  });
});
