import { expect, test, type Locator, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setStaffRole } from "./helpers/billing-db";
import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * /pos layout inside the app shell: the phone checkout bar (which sits on top
 * of the shell's tab bar), the two-column tablet/desktop layout, the shell
 * navigation (bottom tabs + "More" sheet on phones, a rail on md+), the
 * revenue privacy toggle, and the cart clearing as soon as a sale is saved.
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

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(44);
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

    // The checkout bar sits on top of the shell's tab bar, never behind it.
    const tabBar = page.getByTestId("app-tabbar");
    await expect(tabBar).toBeVisible();
    const tabBarBox = await tabBar.boundingBox();
    expect(tabBarBox).not.toBeNull();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(tabBarBox!.y + 1);
    const viewportHeight = page.viewportSize()!.height;
    expect(Math.round(tabBarBox!.y + tabBarBox!.height)).toBe(viewportHeight);

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

test.describe("app shell navigation", () => {
  test("phone: bottom tabs, the rest behind More, the current tab is marked", async ({ page, request }) => {
    await createVendorSession(page, request, "shell-phone");
    await createMenuItem(page, { name: "Poha", priceInRupees: 25 });
    await openPos(page, PHONE);

    // One main navigation on screen: the tab bar. The rail is md+ only.
    const tabs = page.getByRole("navigation", { name: "Main" });
    await expect(tabs).toHaveCount(1);
    await expect(page.getByTestId("app-tabbar")).toBeVisible();
    await expect(page.getByTestId("app-rail")).toBeHidden();

    const tab = (name: string) => tabs.getByRole("link", { name, exact: true });
    for (const name of ["Orders", "Drops", "Sell", "Menu"]) {
      await expect(tab(name)).toBeVisible();
      await expectTapTarget(tab(name), `${name} tab`);
    }
    await expect(tab("Sell")).toHaveAttribute("aria-current", "page");
    await expect(tab("Orders")).not.toHaveAttribute("aria-current", "page");

    // The rest stays behind More until it is opened.
    await expect(page.getByRole("link", { name: "Transactions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    const more = tabs.getByRole("button", { name: "More" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).not.toHaveAttribute("aria-current", "page");
    await expectTapTarget(more, "More tab");

    await more.click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    for (const name of ["Transactions", "Analytics", "Settings"]) {
      await expect(sheet.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(sheet.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    // The store is not published yet, so there is nothing live to link to.
    await expect(sheet.getByRole("link", { name: /Live store/ })).toHaveCount(0);

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();

    // A destination under More marks the More tab as current.
    await more.click();
    await sheet.getByRole("link", { name: "Transactions", exact: true }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(more).toHaveAttribute("aria-current", "page");
    await expect(tab("Sell")).not.toHaveAttribute("aria-current", "page");

    // Tabs navigate, and a page inside a section keeps that section's tab marked.
    await tab("Drops").click();
    await expect(page).toHaveURL(/\/drops$/);
    await expect(tab("Drops")).toHaveAttribute("aria-current", "page");
    await page.goto("/drops/new");
    await expect(page.getByRole("heading", { level: 1, name: "New drop" })).toBeVisible();
    await expect(tab("Drops")).toHaveAttribute("aria-current", "page");

    await tab("Sell").click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("phone: Live store appears under More once the store is published", async ({ page, request }) => {
    await createVendorSession(page, request, "shell-live");
    const publish = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(publish.status()).toBe(200);
    await openPos(page, PHONE);

    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" }).click();
    const live = page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Live store/ });
    await expect(live).toBeVisible();
    await expect(live).toHaveAttribute("href", /^\/s\//);
    await expect(live).toHaveAttribute("target", "_blank");
  });

  test("desktop: a left rail lists every destination and there is no tab bar", async ({ page, request }) => {
    await createVendorSession(page, request, "shell-desktop");
    await createMenuItem(page, { name: "Upma", priceInRupees: 20 });
    await openPos(page, DESKTOP);

    const rail = page.getByRole("navigation", { name: "Main" });
    await expect(rail).toHaveCount(1);
    await expect(page.getByTestId("app-rail")).toBeVisible();
    await expect(page.getByTestId("app-tabbar")).toBeHidden();

    const item = (name: string) => rail.getByRole("link", { name, exact: true });
    for (const name of ["Orders", "Drops", "Sell", "Menu", "Transactions", "Analytics", "Settings"]) {
      await expect(item(name)).toBeVisible();
      await expectTapTarget(item(name), `${name} rail link`);
    }
    await expect(rail.getByRole("button", { name: "More" })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(item("Sell")).toHaveAttribute("aria-current", "page");

    // Page content starts to the right of the rail, not underneath it.
    const railBox = await rail.boundingBox();
    const headingBox = await page.getByRole("heading", { name: "Quick add" }).boundingBox();
    expect(railBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);

    await item("Settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(item("Settings")).toHaveAttribute("aria-current", "page");
    await expect(item("Sell")).not.toHaveAttribute("aria-current", "page");

    // A section page inside Settings keeps Settings marked, next to the section sidebar.
    await page.goto("/settings/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(item("Settings")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Settings", exact: true })).toBeVisible();
  });

  test("a cashier sees only Orders, Sell, Settings and Sign out", async ({ page, request }) => {
    // Registration only creates an OWNER; the role is changed straight in the database.
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to demote the owner to CASHIER");
    const creds = await createVendorSession(page, request, "shell-cashier");
    await createMenuItem(page, { name: "Dhokla", priceInRupees: 30 });
    await setStaffRole(creds.email, "CASHIER");

    await openPos(page, PHONE);
    const tabs = page.getByRole("navigation", { name: "Main" });
    await expect(tabs.getByRole("link", { name: "Orders", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Sell", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Drops", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "Menu", exact: true })).toHaveCount(0);

    await tabs.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Transactions", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.setViewportSize(DESKTOP);
    const rail = page.getByRole("navigation", { name: "Main" });
    await expect(rail.getByRole("link")).toHaveText(["Orders", "Sell", "Settings"]);

    // Hiding links is cosmetic: the server still turns a cashier away from /drops.
    await page.goto("/drops");
    await expect(page).toHaveURL(/\/pos$/);
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
