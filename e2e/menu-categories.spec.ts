import { expect, test } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The seller's Menu screen shows one section per category, A–Z like the store
 * page, with a Category choice; cards move only inside their section
 * (lib/menu-category.ts, docs/MENU_CATEGORY_FILTER_PLAN.md).
 */
test.describe("menu screen categories", () => {
  test("sections A–Z, a category filter, moves stay inside a section", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-cat", "/menu");
    // Created out of A–Z order on purpose: the screen sorts by category, then the seller's order.
    await createMenuItem(page, { name: "Samosa", priceInRupees: 20, category: "Snacks" });
    await createMenuItem(page, { name: "Masala Chai", priceInRupees: 15, category: "Drinks" });
    await createMenuItem(page, { name: "Kachori", priceInRupees: 20, category: "Snacks" });
    await createMenuItem(page, { name: "Lassi", priceInRupees: 40, category: "Drinks" });

    await page.goto("/menu");
    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings.filter({ hasText: /^(Drinks|Snacks)$/ })).toHaveText(["Drinks", "Snacks"]);
    const snacks = page.getByRole("region", { name: "Snacks" });
    const drinks = page.getByRole("region", { name: "Drinks" });
    await expect(snacks.getByText("Samosa", { exact: true })).toBeVisible();
    await expect(drinks.getByText("Lassi", { exact: true })).toBeVisible();

    // A section's first card can't go up and its last can't go down, even with another section next to it.
    await expect(page.getByRole("button", { name: "Move Samosa up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Lassi down" })).toBeDisabled();

    // Only Snacks; moving still works there.
    await page.getByRole("radio", { name: /^Snacks/ }).check();
    await expect(drinks).toHaveCount(0);
    await expect(page.getByText("Masala Chai", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Move Kachori up" }).click();
    await expect(page.getByText("Order updated")).toBeVisible();

    // The new order is saved: Kachori now leads Snacks after a reload.
    await page.reload();
    const snackMoves = page.getByRole("region", { name: "Snacks" }).getByRole("button", { name: /^Move .* up$/ });
    await expect
      .poll(() => snackMoves.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))))
      .toEqual(["Move Kachori up", "Move Samosa up"]);
    await expect(page.getByRole("button", { name: "Move Kachori up" })).toBeDisabled();

    // Back to every category.
    await page.getByRole("radio", { name: "All categories" }).check();
    await expect(page.getByRole("region", { name: "Drinks" })).toBeVisible();
  });

  test("one category: no sections and no Category choice", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-cat-one", "/menu");
    await createMenuItem(page, { name: "Samosa", priceInRupees: 20, category: "Snacks" });
    await createMenuItem(page, { name: "Kachori", priceInRupees: 20, category: "Snacks" });
    await page.goto("/menu");
    await expect(page.getByText("Samosa", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "All categories" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Snacks" })).toHaveCount(0);
  });
});
