import { expect, test, type Locator, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Grid and cart affordances on /pos: tile quantity badge, long-press to take
 * one off, line totals, remove + undo, clear cart, menu search and category
 * chips. Taps only — the voice review banner needs a real voice order and is
 * not reachable from here.
 */

async function longPress(page: Page, target: Locator, holdMs = 800): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("long-press target has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

const MIN_TAP = 44;

async function expectTapTarget(locator: Locator, min: number, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(min);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(min);
}

test.describe("POS grid and cart", () => {
  test("tile badge, long-press decrement and line totals", async ({ page, request }) => {
    await createVendorSession(page, request, "poscart-tile");
    await createMenuItem(page, { name: "Vada Pav", priceInRupees: 20 });

    await page.goto("/pos");
    const tile = page.getByRole("button", { name: /^Vada Pav/ });
    const cart = page.getByRole("region", { name: "Cart" });

    await tile.click();
    await tile.click();
    // The badge is aria-hidden; the sr-only suffix keeps the name anchored on the item.
    await expect(tile).toHaveAccessibleName(/^Vada Pav.*2 in cart/);
    await expect(cart).toContainText("2 × ₹20.00");
    await expect(cart).toContainText("₹40.00");

    // A long-press takes one off and must not also add one.
    await longPress(page, tile);
    await expect(cart).toContainText("1 × ₹20.00");
    await expect(tile).toHaveAccessibleName(/^Vada Pav.*1 in cart/);

    // Long-press on the last one empties the line.
    await longPress(page, tile);
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
    await expect(tile).not.toHaveAccessibleName(/in cart/);
  });

  test("a slow press on a tile not in the cart still adds it", async ({ page, request }) => {
    await createVendorSession(page, request, "poscart-slowtap");
    await createMenuItem(page, { name: "Kachori", priceInRupees: 25 });

    await page.goto("/pos");
    const tile = page.getByRole("button", { name: /^Kachori/ });
    // Held past the long-press threshold, but there is nothing to take off.
    await longPress(page, tile);
    await expect(page.getByRole("region", { name: "Cart" })).toContainText("1 × ₹25.00");
    await expect(tile).toHaveAccessibleName(/^Kachori.*1 in cart/);
  });

  test("remove shows an undo toast that restores the line", async ({ page, request }) => {
    await createVendorSession(page, request, "poscart-undo");
    await createMenuItem(page, { name: "Samosa", priceInRupees: 15 });

    await page.goto("/pos");
    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Samosa/ }).click();

    await page.getByRole("button", { name: "Remove Samosa" }).click();
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
    await expect(page.getByText("Removed Samosa")).toBeVisible();

    const undo = page.getByRole("button", { name: "Undo" });
    await expectTapTarget(undo, MIN_TAP, "Undo toast action");
    await undo.click();
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toContainText("2 × ₹15.00");
    await expect(cart).toContainText("₹30.00");
  });

  test("a second remove replaces the first undo toast", async ({ page, request }) => {
    await createVendorSession(page, request, "poscart-undo2");
    await createMenuItem(page, { name: "Samosa", priceInRupees: 15 });
    await createMenuItem(page, { name: "Chai", priceInRupees: 10 });

    await page.goto("/pos");
    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Chai/ }).click();

    await page.getByRole("button", { name: "Remove Samosa" }).click();
    await expect(page.getByText("Removed Samosa")).toBeVisible();
    await page.getByRole("button", { name: "Remove Chai" }).click();
    await expect(page.getByText("Removed Chai")).toBeVisible();
    // Only one undo can be honoured, so only one may be offered.
    await expect(page.getByText("Removed Samosa")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(1);

    await page.getByRole("button", { name: "Undo" }).click();
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toContainText("1 × ₹10.00");
    await expect(page.getByRole("button", { name: "Remove Samosa" })).toHaveCount(0);
  });

  test("clear cart confirms only for more than two lines", async ({ page, request }) => {
    await createVendorSession(page, request, "poscart-clear");
    await createMenuItem(page, { name: "Idli", priceInRupees: 30 });
    await createMenuItem(page, { name: "Dosa", priceInRupees: 50 });
    await createMenuItem(page, { name: "Upma", priceInRupees: 40 });

    await page.goto("/pos");
    await expect(page.getByRole("button", { name: "Clear cart" })).toHaveCount(0);

    // Two lines: clears straight away, no dialog.
    await page.getByRole("button", { name: /^Idli/ }).click();
    await page.getByRole("button", { name: /^Dosa/ }).click();
    let dialogSeen = false;
    const onDialog = () => {
      dialogSeen = true;
    };
    page.on("dialog", onDialog);
    await page.getByRole("button", { name: "Clear cart" }).click();
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
    expect(dialogSeen).toBe(false);
    page.off("dialog", onDialog);

    // Three lines: dismissing the confirm keeps the cart.
    await page.getByRole("button", { name: /^Idli/ }).click();
    await page.getByRole("button", { name: /^Dosa/ }).click();
    await page.getByRole("button", { name: /^Upma/ }).click();
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toContainText("₹120.00");

    page.once("dialog", (d) => void d.dismiss());
    await page.getByRole("button", { name: "Clear cart" }).click();
    await expect(cart).toContainText("₹120.00");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Clear cart" }).click();
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
  });

  test("long menus get search and category chips", async ({ page, request }) => {
    test.slow(); // seeds 16 menu items over the API
    await createVendorSession(page, request, "poscart-search");
    const snacks = ["Samosa", "Kachori", "Vada Pav", "Pav Bhaji", "Bhel Puri", "Pani Puri", "Sev Puri", "Dabeli"];
    const drinks = ["Masala Chai", "Filter Coffee", "Lassi", "Nimbu Pani", "Jaljeera", "Badam Milk", "Rose Milk", "Buttermilk"];
    for (const name of snacks) await createMenuItem(page, { name, priceInRupees: 20, category: "Snacks" });
    for (const name of drinks) await createMenuItem(page, { name, priceInRupees: 15, category: "Drinks" });

    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();

    const search = page.getByLabel("Search menu");
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to Snacks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to Drinks" })).toBeVisible();

    // Name match, case-insensitive.
    await search.fill("PAV");
    await expect(page.getByRole("button", { name: /^Vada Pav/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pav Bhaji/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Samosa/ })).toHaveCount(0);

    // Category match.
    await search.fill("drinks");
    await expect(page.getByRole("button", { name: /^Lassi/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Samosa/ })).toHaveCount(0);

    await search.fill("zzz");
    await expect(page.getByText(/No items match/)).toBeVisible();

    // A chip clears the search and brings its section into view.
    await page.getByRole("button", { name: "Jump to Drinks" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: /^Samosa/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drinks", level: 3 })).toBeInViewport();

    // Filtered tiles still add to the cart.
    await search.fill("lassi");
    await page.getByRole("button", { name: /^Lassi/ }).click();
    await expect(page.getByRole("region", { name: "Cart" })).toContainText("1 × ₹15.00");
  });
});
