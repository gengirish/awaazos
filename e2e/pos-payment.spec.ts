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
  test("no UPI ID: cash is the default, change calculator blocks a short tender, receipt reads 'Cash'", async ({
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
    await expect(dialog.getByRole("radio", { name: /cash/i })).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: /cash/i })).toHaveCount(0);

    // Quick tenders: next notes above ₹40, plus Exact.
    await expect(dialog.getByRole("button", { name: "Exact" })).toBeVisible();
    await dialog.getByRole("button", { name: "₹100", exact: true }).click();
    await expect(received).toHaveValue("100");
    await expect(dialog).toContainText("Change to return");
    await expect(dialog).toContainText("₹60.00");

    // Short blocks the sale until the rest is handed over.
    await received.fill("30");
    await expect(dialog.getByText(/Short by ₹10\.00/)).toBeVisible();
    await expect(markPaid).toBeDisabled();

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

    await dialog.getByRole("radio", { name: "UPI QR" }).check();
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

  test("undo: the sale is reverted, the cart comes back and the sheet reopens", async ({ page, request }) => {
    await createVendorSession(page, request, "pospay-undo");
    const dialog = await ringUpForty(page);

    await dialog.getByRole("button", { name: "₹100", exact: true }).click();
    await expect(dialog).toContainText("Return ₹60.00");
    await dialog.getByRole("button", { name: /Mark as paid/ }).click();

    await expect(page.getByText(/AWZ-\d{8}-\d{4}/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Payment recorded · ₹40.00 Cash")).toBeVisible();
    // The sale is on the books, with what was handed over.
    const before = (await (await page.request.get("/api/transactions")).json()) as { total: number };
    expect(before.total).toBe(1);

    // Undo from the receipt sheet (the toast offers the same).
    await page.getByRole("button", { name: "Undo payment" }).click();
    await expect(page.getByText("Payment undone")).toBeVisible({ timeout: 20_000 });
    // The receipt sheet may still be animating out, so name the dialog.
    const reopened = page.getByRole("dialog", { name: "Collect payment" });
    await expect(reopened).toBeVisible();
    await expect(reopened).toContainText("₹40.00");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Cart" })).toContainText("₹40.00");

    const after = (await (await page.request.get("/api/transactions")).json()) as { total: number };
    expect(after.total).toBe(0);
  });

  test("undo disappears after its window", async ({ page, request }) => {
    await createVendorSession(page, request, "pospay-undo-late");
    const dialog = await ringUpForty(page);
    await dialog.getByRole("button", { name: /Mark as paid/ }).click();
    const undo = page.getByRole("button", { name: "Undo payment" });
    await expect(undo).toBeVisible({ timeout: 20_000 });
    await expect(undo).toBeHidden({ timeout: 10_000 });
  });

  test("with a UPI ID: payee line, full-screen QR keeps the sheet's state, keyboard shortcuts", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pospay-qr");
    const patch = await page.request.patch("/api/vendor", {
      data: { upiId: "e2e-qr@okaxis", upiName: "Sam Store" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.ok(), "saving a UPI ID").toBe(true);

    const dialog = await ringUpForty(page);
    await expect(dialog.getByText(/Paying\s*Sam Store/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Copy UPI ID" })).toBeVisible();

    await dialog.getByRole("button", { name: "Add UPI reference (optional)" }).click();
    await dialog.getByLabel(/UPI Reference/).fill("123456789012");

    await dialog.getByRole("button", { name: "Show to customer" }).click();
    const full = page.getByRole("dialog", { name: /UPI QR code to pay ₹40\.00 to Sam Store/ });
    await expect(full).toBeVisible();
    await expect(full).toContainText("Scan with any UPI app");
    await page.keyboard.press("Escape");
    await expect(full).toBeHidden();
    // Esc closed only the full-screen layer; the sheet kept what was typed.
    await expect(page.getByRole("dialog", { name: "Collect payment" })).toBeVisible();
    await expect(page.getByLabel(/UPI Reference/)).toHaveValue("123456789012");

    // Tap outside the QR closes it too.
    await page.getByRole("button", { name: "Show to customer" }).click();
    await expect(full).toBeVisible();
    await full.getByText("Scan with any UPI app").click();
    await expect(full).toBeHidden();

    // Shortcuts: not while typing in a field, yes once focus leaves it.
    const sheet = page.getByRole("dialog", { name: "Collect payment" });
    await sheet.getByLabel(/UPI Reference/).press("c");
    await expect(sheet.getByRole("radio", { name: "UPI QR" })).toBeChecked();
    await sheet.getByRole("radio", { name: "UPI QR" }).focus();
    await page.keyboard.press("c");
    await expect(sheet.getByRole("radio", { name: "Cash" })).toBeChecked();
    await page.keyboard.press("u");
    await expect(sheet.getByRole("radio", { name: "UPI QR" })).toBeChecked();
    await expect(sheet.getByRole("button", { name: /Mark as paid/ })).toHaveAttribute("aria-keyshortcuts", "Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Paid ₹40\.00 via UPI/)).toBeVisible({ timeout: 20_000 });
  });
});
