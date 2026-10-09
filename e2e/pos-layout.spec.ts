import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * /pos shell and layout: the phone checkout bar, the two-column tablet/desktop
 * layout, the trimmed nav with its "More" overflow, the revenue privacy toggle,
 * and the cart clearing as soon as a sale is saved.
 *
 * Viewports are set per test so both Playwright projects (Desktop Chrome and
 * Pixel 7) exercise the same breakpoint.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function openPos(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/pos");
  await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
}

test.describe("POS layout — phone", () => {
  test("the sticky bar holds the only Collect payment button and never covers the cart", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "layout-phone");
    await createMenuItem(page, { name: "Samosa", priceInRupees: 15 });
    await createMenuItem(page, { name: "Masala Chai", priceInRupees: 10 });
    await openPos(page, PHONE);

    const collect = page.getByRole("button", { name: /Collect payment/ });
    // Present while the cart is empty, but disabled.
    await expect(collect).toHaveCount(1);
    await expect(collect).toBeVisible();
    await expect(collect).toBeDisabled();
    await expect(page.getByRole("button", { name: "View cart (0)" })).toBeVisible();

    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Masala Chai/ }).click();

    await expect(collect).toHaveCount(1);
    await expect(collect).toBeEnabled();
    await expect(collect).toContainText("₹40.00");

    const collectBox = await collect.boundingBox();
    expect(collectBox, "collect button laid out").not.toBeNull();
    expect(Math.round(collectBox!.height)).toBeGreaterThanOrEqual(44);

    // "View cart (3)" brings the cart into view.
    await page.getByRole("button", { name: "View cart (3)" }).click();
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toBeInViewport();

    // Scrolled to the very bottom, the cart's last row sits above the bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = page.getByTestId("sticky-checkout-bar");
    const barBox = await bar.boundingBox();
    const cartBox = await cart.boundingBox();
    expect(barBox).not.toBeNull();
    expect(cartBox).not.toBeNull();
    expect(cartBox!.y + cartBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

    await collect.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("₹40.00");
  });
});

test.describe("POS layout — desktop", () => {
  test("grid and cart sit side by side and the sticky bar is hidden", async ({ page, request }) => {
    await createVendorSession(page, request, "layout-desktop");
    await createMenuItem(page, { name: "Idli", priceInRupees: 30 });
    await openPos(page, DESKTOP);

    await expect(page.getByTestId("sticky-checkout-bar")).toBeHidden();
    await expect(page.getByRole("button", { name: /Collect payment/ })).toHaveCount(1);

    const gridBox = await page.getByRole("heading", { name: "Quick add" }).boundingBox();
    const cartBox = await page.getByRole("region", { name: "Cart" }).boundingBox();
    expect(gridBox).not.toBeNull();
    expect(cartBox).not.toBeNull();
    // Cart column is to the right of the grid column, at roughly the same height.
    expect(cartBox!.x).toBeGreaterThan(gridBox!.x + gridBox!.width / 2);
    expect(cartBox!.y).toBeLessThan(gridBox!.y + 400);
  });
});

test.describe("POS navigation", () => {
  test("Orders and Drops up front, the rest behind More, one Settings link", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "layout-nav");
    await createMenuItem(page, { name: "Poha", priceInRupees: 25 });
    await openPos(page, PHONE);

    const nav = page.getByRole("navigation", { name: "POS navigation" });
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Drops" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Transactions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(1);

    const more = nav.getByRole("button", { name: "More" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const moreBox = await more.boundingBox();
    expect(Math.round(moreBox!.height)).toBeGreaterThanOrEqual(44);

    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Menu", "Transactions", "Analytics"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(nav.getByRole("link", { name: "Transactions" })).toHaveCount(0);
    await expect(more).toBeFocused();

    // Outside click closes too.
    await more.click();
    await expect(nav.getByRole("link", { name: "Menu" })).toBeVisible();
    await page.getByRole("heading", { name: "Quick add" }).click();
    await expect(nav.getByRole("link", { name: "Menu" })).toHaveCount(0);

    await more.click();
    await nav.getByRole("link", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
  });
});

test.describe("POS revenue privacy", () => {
  test("hiding today's total masks it and persists on this device", async ({ page, request }) => {
    await createVendorSession(page, request, "layout-privacy");
    await createMenuItem(page, { name: "Upma", priceInRupees: 20 });
    await openPos(page, PHONE);

    const header = page.getByRole("banner").filter({ hasText: "Today (IST)" });
    const toggle = page.getByRole("button", { name: "Hide today's total" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(header).toContainText("₹0.00");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(header).toContainText("₹ ••••");
    await expect(header).not.toContainText("₹0.00");

    await page.reload();
    await expect(page.getByRole("button", { name: "Hide today's total" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(header).toContainText("₹ ••••");

    await page.getByRole("button", { name: "Hide today's total" }).click();
    await expect(header).toContainText("₹0.00");
  });
});

test.describe("POS sale clears the cart", () => {
  test("dismissing the receipt with Escape leaves an empty cart", async ({ page, request }) => {
    await createVendorSession(page, request, "layout-clear");
    await createMenuItem(page, { name: "Vada Pav", priceInRupees: 20 });
    await openPos(page, DESKTOP);

    await page.getByRole("button", { name: /^Vada Pav/ }).click();
    await page.getByRole("button", { name: /Collect payment/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cash" }).click();
    await dialog.getByRole("button", { name: /Mark as paid/ }).click();
    await expect(page.getByText(/AWZ-\d{8}-\d{4}/)).toBeVisible({ timeout: 20_000 });

    // Not "New order" — the receipt is dismissed without its clear-cart button.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Collect payment/ })).toBeDisabled();
  });
});
