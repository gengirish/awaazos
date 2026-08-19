import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * The headline flow, driven the way a vendor actually drives it: taps only.
 *
 * Deliberately the CASH path. `UpiQRModal` disables "Mark as paid" in UPI mode
 * until the vendor has a `upiId`, and `/api/auth/register` does not set one —
 * a UPI sale would need onboarding completed first.
 */

/** The QR image is fetched from api.qrserver.com; stub it so CI never needs egress. */
async function stubQrService(page: Page): Promise<void> {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**://api.qrserver.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng }),
  );
}

test.describe("POS sale — driven through the UI", () => {
  test("tap item → collect payment → cash → paid, mints a bill and clears the cart", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "posui");
    await stubQrService(page);

    // Seeded before navigation: /pos is a server component that reads menu
    // items from Prisma at render time, not via a client fetch.
    await createMenuItem(page, { name: "Samosa", priceInRupees: 15 });
    await createMenuItem(page, { name: "Masala Chai", priceInRupees: 10 });

    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();

    // QuickAddGrid buttons take their accessible name from "{name} {formatINR}",
    // e.g. "Samosa ₹15.00". Anchor the regex so "Chai" can't match "Masala Chai".
    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Samosa/ }).click();
    await page.getByRole("button", { name: /^Masala Chai/ }).click();

    // The cart is the aria-live region; assert through the totals rather than
    // the qty span, which has no role, label or testid.
    // <section aria-labelledby="cart-heading"> exposes as role=region with that name.
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toContainText("Samosa");
    await expect(cart).toContainText("Masala Chai");
    // 1500×2 + 1000 = 4000 paise → ₹40.00
    await expect(cart).toContainText("₹40.00");

    await page.getByRole("button", { name: "Collect payment" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("₹40.00");

    await dialog.getByRole("button", { name: "Cash" }).click();
    // The accessible name carries a trailing ✓, so exact matching would fail.
    await dialog.getByRole("button", { name: /Mark as paid/ }).click();

    // Receipt modal — bill number is AWZ-YYYYMMDD-NNNN.
    await expect(page.getByText(/AWZ-\d{8}-\d{4}/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Paid ₹40\.00 via CASH/)).toBeVisible();

    await page.getByRole("button", { name: /New order/ }).click();

    // cartStore has no persistence and newOrder() calls clearCart() +
    // router.refresh(), so the cart must return to its empty state.
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Collect payment" })).toBeDisabled();
  });

  test("cart quantity controls add, decrement and remove a line", async ({ page, request }) => {
    await createVendorSession(page, request, "posui-qty");
    await createMenuItem(page, { name: "Vada Pav", priceInRupees: 20 });

    await page.goto("/pos");
    await page.getByRole("button", { name: /^Vada Pav/ }).click();
    await page.getByRole("button", { name: /^Vada Pav/ }).click();

    // <section aria-labelledby="cart-heading"> exposes as role=region with that name.
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toContainText("₹40.00"); // 2000 × 2

    await page.getByRole("button", { name: "Decrease Vada Pav" }).click();
    await expect(cart).toContainText("₹20.00");

    await page.getByRole("button", { name: "Increase Vada Pav" }).click();
    await expect(cart).toContainText("₹40.00");

    await page.getByRole("button", { name: "Remove Vada Pav" }).click();
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
  });

  test("empty menu shows the guidance state instead of an empty grid", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "posui-empty");

    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: "No items yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open menu/ })).toBeVisible();
  });
});
