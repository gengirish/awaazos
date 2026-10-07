import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Settings is a short hub (/settings) plus one page per area. These check the
 * hub's live status lines, the setup checklist, and the phone navigation.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const ROWS = [
  { title: "Online store", path: "/settings/store", heading: "Online store" },
  { title: "Online orders", path: "/settings/orders", heading: "Online orders" },
  { title: "Payments", path: "/settings/payments", heading: "Payments" },
  { title: "Counter & voice", path: "/settings/voice", heading: "Counter & voice" },
  { title: "Plan & billing", path: "/settings/billing", heading: "Plan & billing" },
] as const;

function hubRow(page: Page, title: string) {
  return page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: new RegExp(`^${title}`) });
}

async function setSwitch(page: Page, name: RegExp, on: boolean) {
  const sw = page.getByRole("switch", { name });
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
}

test.describe("settings hub", () => {
  test("shows five areas with live status, each row opens its page, checklist clears when set up", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await createVendorSession(page, request, "settings-hub", "/settings");
    await createMenuItem(page, { name: "Masala Dosa", priceInRupees: 70 });

    // No UPI ID and pay on delivery off: customers would have no way to pay.
    await page.goto("/settings/payments");
    await setSwitch(page, /pay on delivery/i, false);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(hubRow(page, "Online store")).toContainText("Not published");
    await expect(hubRow(page, "Online orders")).toContainText("Order from menu: Off");
    await expect(hubRow(page, "Payments")).toContainText("UPI");
    await expect(hubRow(page, "Payments")).toContainText("Pay on delivery");
    await expect(hubRow(page, "Counter & voice")).toContainText("English");
    await expect(hubRow(page, "Plan & billing")).toContainText("Free plan");

    const checklist = page.getByRole("region", { name: /setup checklist/i });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByRole("link", { name: /publish your online store/i })).toBeVisible();
    await expect(checklist.getByRole("link", { name: /UPI ID or allow pay on delivery/i })).toBeVisible();
    // A menu item exists, so that step is already done.
    await expect(checklist.getByText(/add at least one item/i)).toHaveCount(0);

    for (const row of ROWS) {
      await page.goto("/settings");
      await hubRow(page, row.title).click();
      await expect(page).toHaveURL(new RegExp(`${row.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: row.heading })).toBeVisible();
      // Desktop: the sidebar marks the current page.
      await expect(
        page.getByRole("navigation", { name: "Settings", exact: true }).getByRole("link", { name: row.title }),
      ).toHaveAttribute("aria-current", "page");
    }

    // Fix both checklist items through the checklist's own links.
    await page.goto("/settings");
    await checklist.getByRole("link", { name: /publish your online store/i }).click();
    await expect(page).toHaveURL(/\/settings\/store$/);
    await setSwitch(page, /publish/i, true);

    await page.goto("/settings");
    await checklist.getByRole("link", { name: /UPI ID or allow pay on delivery/i }).click();
    await expect(page).toHaveURL(/\/settings\/payments$/);
    await setSwitch(page, /pay on delivery/i, true);

    await page.goto("/settings");
    await expect(hubRow(page, "Online store")).toContainText("Live · /s/");
    await expect(page.getByRole("region", { name: /setup checklist/i })).toHaveCount(0);
  });

  test("old /settings#anchor links land on the matching section", async ({ page, request }) => {
    await createVendorSession(page, request, "settings-anchor", "/menu");
    await page.goto("/settings#menu-orders");
    await expect(page).toHaveURL(/\/settings\/orders$/);
    await expect(page.getByRole("heading", { level: 1, name: "Online orders" })).toBeVisible();
  });

  test("phone: no sidebar, back link to Settings, way back to the POS, no sideways scroll", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "settings-phone", "/settings");
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/settings/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings", exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: "Back to POS" })).toBeVisible();

    const noSideScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noSideScroll(), "payments page must not scroll sideways at 390px").toBe(true);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(hubRow(page, "Payments")).toBeVisible();
    expect(await noSideScroll(), "hub must not scroll sideways at 390px").toBe(true);

    await page.getByRole("link", { name: "Back to POS" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("payments: the last way to pay can't be switched off while Order from menu is on", async ({
    page,
    request,
  }) => {
    // New vendor: no UPI ID, pay on delivery on by default.
    await createVendorSession(page, request, "settings-lastpay", "/settings");
    const on = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true, acceptMenuOrders: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(on.status()).toBe(200);

    await page.goto("/settings/payments");
    const payOnDelivery = page.getByRole("switch", { name: /pay on delivery/i });
    await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");
    await payOnDelivery.click();

    const notice = page.getByRole("alert").filter({ hasText: /keep at least one way to pay/i });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link", { name: "Go to Online orders" })).toHaveAttribute("href", "/settings/orders");
    await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await expect(page.getByRole("switch", { name: /pay on delivery/i })).toHaveAttribute("aria-checked", "true");
  });
});
