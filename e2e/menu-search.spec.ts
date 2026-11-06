import { expect, test } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The seller's Menu screen gets a search box and a Selling / Sold out filter
 * once the list is long (lib/menu-search.ts). Filtering only hides cards;
 * reordering is off until it is cleared.
 */
test.describe("menu screen search", () => {
  test("filters by words and status, and pauses reordering", async ({ page, request }) => {
    test.slow(); // seeds 16 menu items over the API
    await createVendorSession(page, request, "menu-search", "/menu");
    const snacks = ["Samosa", "Kachori", "Vada Pav", "Pav Bhaji", "Bhel Puri", "Pani Puri", "Sev Puri", "Dabeli"];
    const drinks = ["Masala Chai", "Filter Coffee", "Lassi", "Nimbu Pani", "Jaljeera", "Badam Milk", "Rose Milk"];
    for (const name of snacks) await createMenuItem(page, { name, priceInRupees: 20, category: "Snacks" });
    for (const name of drinks) await createMenuItem(page, { name, priceInRupees: 15, category: "Drinks" });
    const laddu = await createMenuItem(page, {
      name: "Ragi Laddu",
      priceInRupees: 25,
      category: "Sweets",
      description: "Made with jaggery",
      aliasesCsv: "millet ball",
    });
    const off = await page.request.patch(`/api/menu/${laddu.id}`, {
      data: { isAvailable: false },
      headers: { "Content-Type": "application/json" },
    });
    expect(off.ok(), "marking Ragi Laddu sold out").toBe(true);

    await page.goto("/menu");
    const search = page.getByLabel("Search menu");
    await expect(search).toBeVisible();
    const card = (name: string) => page.getByText(name, { exact: true });
    await expect(card("Samosa")).toBeVisible();
    await expect(page.getByRole("button", { name: /Move .* up/ }).first()).toBeAttached();

    // Every word in any order; description and aliases match on staff screens.
    await search.fill("bhaji pav");
    await expect(card("Pav Bhaji")).toBeVisible();
    await expect(card("Vada Pav")).toHaveCount(0);
    await expect(page.getByText("Clear the search to change the order.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Move .* (up|down)/ })).toHaveCount(0);
    await search.fill("jaggery");
    await expect(card("Ragi Laddu")).toBeVisible();
    await search.fill("millet");
    await expect(card("Ragi Laddu")).toBeVisible();
    await expect(card("Samosa")).toHaveCount(0);

    // Sold out only.
    await search.fill("");
    await page.getByRole("radio", { name: "Sold out" }).check();
    await expect(card("Ragi Laddu")).toBeVisible();
    await expect(card("Samosa")).toHaveCount(0);
    await page.getByRole("radio", { name: "Selling" }).check();
    await expect(card("Ragi Laddu")).toHaveCount(0);
    await expect(card("Samosa")).toBeVisible();

    // Nothing matches → Clear search brings everything back and reordering with it.
    await search.fill("biryani");
    await expect(page.getByText(/No items match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("radio", { name: "All" })).toBeChecked();
    await expect(card("Ragi Laddu")).toBeVisible();
    await expect(card("Samosa")).toBeVisible();
    await expect(page.getByRole("button", { name: /Move .* up/ }).first()).toBeAttached();
  });

  test("a short menu has no search box", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-search-short", "/menu");
    await createMenuItem(page, { name: "Samosa", priceInRupees: 20, category: "Snacks" });
    await page.goto("/menu");
    await expect(page.getByText("Samosa", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Search menu")).toHaveCount(0);
  });
});
