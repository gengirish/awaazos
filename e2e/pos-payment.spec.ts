import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Payment and receipt sheets on /pos: default pay mode, the cash change
 * calculator, the UTR disclosure, readable payment method and focus on open.
 *
 * Exactly one "Collect payment" button is visible at any width (sticky bar
 * below md, cart above), so a plain role query picks the right one.
 */

async function ringUpForty(page: Page) {
  await createMenuItem(page, { name: "Samosa", priceInRupees: 20 });
  await page.goto("/pos");
  await page.getByRole("button", { name: /^Samosa/ }).click();
  await page.getByRole("button", { name: /^Samosa/ }).click();
  await expect(page.getByRole("region", { name: "Cart" })).toContainText("₹40.00");
  await page.getByRole("button", { name: "Collect payment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("₹40.00");
  return dialog;
}

test.describe("POS payment sheet", () => {
  test("no UPI ID: cash is the default, change calculator is informational, receipt reads 'Cash'", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pospay-cash");
    const dialog = await ringUpForty(page);

    // Cash mode without touching the toggle; the primary action has focus.
    const markPaid = dialog.getByRole("button", { name: /Mark as paid/ });
    await expect(markPaid).toBeEnabled();
    await expect(markPaid).toBeFocused();
    const received = dialog.getByLabel(/Received/);
    await expect(received).toBeVisible();
    await expect(received).toHaveAttribute("inputmode", "decimal");

    // None of the calculator buttons may collide with the "Cash" mode button.
    await expect(dialog.getByRole("button", { name: /cash/i })).toHaveCount(1);

    // Quick tenders: next notes above ₹40, plus Exact.
    await expect(dialog.getByRole("button", { name: "Exact" })).toBeVisible();
    await dialog.getByRole("button", { name: "₹100", exact: true }).click();
    await expect(received).toHaveValue("100");
    await expect(dialog).toContainText("Change to return");
    await expect(dialog).toContainText("₹60.00");

    // Short is shown but does not block the sale.
    await received.fill("30");
    await expect(dialog.getByText(/₹10\.00 short/)).toBeVisible();
    await expect(markPaid).toBeEnabled();

    await dialog.getByRole("button", { name: "Exact" }).click();
    await expect(received).toHaveValue("40");
    await expect(dialog).toContainText("₹0.00");

    await markPaid.click();

    await expect(page.getByText(/AWZ-\d{8}-\d{4}/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Paid ₹40\.00 via Cash/)).toBeVisible();
    // Once the receipt text loads, focus sits on the WhatsApp link.
    await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toBeFocused({ timeout: 20_000 });

    const newOrder = page.getByRole("button", { name: /New order/ });
    await expect(newOrder).toHaveText("New order");
    await newOrder.click();
    await expect(page.getByText("Tap items or use voice to build an order.")).toBeVisible();
  });

  test("no UPI ID: the UPI tab says to take cash, links to payment settings and resets to cash on close", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pospay-noupi");
    const dialog = await ringUpForty(page);

    await dialog.getByRole("button", { name: "UPI QR" }).click();
    await expect(dialog.getByText("Take cash now — add a UPI ID in Settings later.")).toBeVisible();
    const link = dialog.getByRole("link", { name: "Payment settings" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/settings/payments");
    await expect(dialog.getByRole("button", { name: /Mark as paid/ })).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Collect payment" }).click();
    await expect(page.getByRole("dialog").getByLabel(/Received/)).toBeVisible();
  });

  test("with a UPI ID: UPI is the default, UTR sits behind a disclosure and resets on close", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pospay-upi");
    const patch = await page.request.patch("/api/vendor", {
      data: { upiId: "e2e-pos@okaxis", upiName: "E2E POS" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.ok(), "saving a UPI ID").toBe(true);

    const dialog = await ringUpForty(page);
    await expect(dialog.getByRole("img", { name: /UPI payment QR code/i })).toBeVisible();
    await expect(dialog.getByLabel(/UPI Reference/)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Add UPI reference (optional)" }).click();
    const utr = dialog.getByLabel(/UPI Reference/);
    await expect(utr).toBeVisible();
    await expect(utr).toBeFocused();
    await utr.fill("123456789012");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Collect payment" }).click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.getByRole("img", { name: /UPI payment QR code/i })).toBeVisible();
    await expect(reopened.getByLabel(/UPI Reference/)).toHaveCount(0);
    await expect(reopened.getByRole("button", { name: "Add UPI reference (optional)" })).toBeVisible();

    await reopened.getByRole("button", { name: /Mark as paid/ }).click();
    await expect(page.getByText(/Paid ₹40\.00 via UPI/)).toBeVisible({ timeout: 20_000 });
  });
});
