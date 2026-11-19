import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * Sorting the store page's menu (lib/catalogue-sort.ts, docs/PRODUCT_PAGE_PLAN.md
 * step 5): 13 items show the control, a price sort reorders into one list with
 * no category headings, the pick is remembered on the device for the read-only
 * menu too, and 12 items show no control.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

// Rupee prices in the seller's order; cheapest is index 4, dearest index 9.
const PRICES = [60, 90, 40, 120, 15, 75, 50, 110, 30, 140, 45, 80, 100];

function firstItem(buyer: Page) {
  return buyer.locator("main [data-detail-trigger]").first();
}

test.describe("catalogue sort", () => {
  test("13 items sort by price, remembered per store; 12 show no control", async ({ page, request, browser }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const names = PRICES.map((_, i) => `Sortable ${String.fromCharCode(65 + i)} ${suffix}`);

    await createVendorSession(page, request, "sort", "/menu");
    const created = [];
    for (const [i, price] of PRICES.entries()) {
      created.push(
        await createMenuItem(page, { name: names[i], priceInRupees: price, category: i % 2 === 0 ? "Snacks" : "Mains" }),
      );
    }
    const { slug } = await openStoreForMenuOrders(page);

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      const sort = buyer.getByRole("group", { name: "Sort" });
      await expect(sort).toBeVisible();
      await expect(sort.getByRole("radio", { name: "Our order" })).toBeChecked();
      await expect(buyer.getByRole("heading", { name: "Snacks", exact: true })).toBeVisible();

      await sort.getByText("Price: low to high").click();
      await expect(firstItem(buyer)).toContainText(names[4]);
      await expect(buyer.getByRole("heading", { name: "Snacks", exact: true })).toHaveCount(0);
      await expect(buyer.getByRole("link", { name: "Snacks", exact: true })).toBeHidden();

      await sort.getByText("Price: high to low").click();
      await expect(firstItem(buyer)).toContainText(names[9]);

      // Remembered on this device, and the read-only menu (no menu orders) sorts the same way.
      expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: false } })).ok()).toBe(true);
      await buyer.reload();
      await expect(buyer.getByRole("radio", { name: "Price: high to low" })).toBeChecked();
      await expect(firstItem(buyer)).toContainText(names[9]);

      await buyer.getByRole("group", { name: "Sort" }).getByText("Our order").click();
      await expect(buyer.getByRole("heading", { name: "Mains", exact: true })).toBeVisible();
      await expect(firstItem(buyer)).toContainText(names[1]);

      // 12 items: everything fits at a glance, no control.
      const removed = await page.request.delete(`/api/menu/${created[0].id}`);
      expect(removed.ok()).toBe(true);
      await buyer.reload();
      await expect(buyer.getByRole("heading", { name: "Mains", exact: true })).toBeVisible();
      await expect(buyer.getByRole("group", { name: "Sort" })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
