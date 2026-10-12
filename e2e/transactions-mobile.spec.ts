import { expect, test, type Locator, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, type TransactionCreated } from "./helpers/vendor";

/**
 * /transactions on a phone: a card list instead of the six-column table, the
 * filters behind a bottom sheet, and the bill detail in a bottom sheet with a
 * stacked item list. From md up the table and the inline filter row stay.
 *
 * Viewports are set per test so both Playwright projects (Desktop Chrome and
 * Pixel 7) exercise the same breakpoint.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** One paid cash sale: 2 × Samosa at ₹20 = ₹40.00. */
async function ringUpSale(page: Page): Promise<TransactionCreated> {
  const item = await createMenuItem(page, { name: "Samosa", priceInRupees: 20 });
  const res = await page.request.post("/api/transactions", {
    data: {
      items: [{ menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 2 }],
      subtotalPaise: 4000,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 4000,
      paymentMethod: "CASH",
      source: "MANUAL",
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status(), "POS sale").toBe(201);
  return (await res.json()) as TransactionCreated;
}

async function openTransactions(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
}

async function expectInsideViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(Math.round(box!.x + box!.width), `${label} right edge`).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.describe("transactions — phone", () => {
  test("a card list replaces the table and nothing scrolls sideways", async ({ page, request }) => {
    await createVendorSession(page, request, "tx-phone-list");
    const sale = await ringUpSale(page);
    await openTransactions(page, PHONE);

    const cards = page.getByTestId("transaction-cards");
    await expect(cards).toBeVisible();
    await expect(page.getByTestId("transactions-table")).toBeHidden();
    // The hidden table is out of the accessibility tree too.
    await expect(page.getByRole("table")).toHaveCount(0);

    const row = cards.getByRole("button", { name: new RegExp(sale.transaction.billNumber) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("₹40.00");
    await expect(row).toContainText("2 items");
    await expect(row).toContainText("Cash");
    await expect(row).toContainText("Paid");

    // Total and status are on screen without a sideways scroll.
    await expectInsideViewport(page, row.getByText("₹40.00"), "total");
    await expectInsideViewport(page, row.getByText("Paid", { exact: true }), "status");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);

    // The whole row is one comfortable tap target.
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(Math.round(rowBox!.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(rowBox!.width)).toBeGreaterThanOrEqual(300);

    // The inline filter fields are collapsed; Export stays one tap away.
    // (getByLabel also matches display:none nodes, so assert hidden, not absent.)
    await expect(page.getByLabel("From")).toBeHidden();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

    // Pagination sits above the shell's tab bar.
    const next = page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Next" });
    await next.scrollIntoViewIfNeeded();
    const nextBox = await next.boundingBox();
    const tabBarBox = await page.getByTestId("app-tabbar").boundingBox();
    expect(nextBox).not.toBeNull();
    expect(tabBarBox).not.toBeNull();
    expect(Math.round(nextBox!.height)).toBeGreaterThanOrEqual(44);
    expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(tabBarBox!.y + 1);
  });

  test("the filters sheet applies a status filter through the URL", async ({ page, request }) => {
    await createVendorSession(page, request, "tx-phone-filters");
    const sale = await ringUpSale(page);
    await openTransactions(page, PHONE);

    const filtersButton = page.getByRole("button", { name: /^Filters/ });
    await expect(page.getByTestId("active-filter-count")).toHaveCount(0);
    await filtersButton.click();

    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("From")).toHaveAttribute("type", "date");
    await expect(sheet.getByLabel("To")).toHaveAttribute("type", "date");
    await expect(sheet.getByRole("combobox", { name: "Method" })).toBeVisible();

    // The only sale is paid, so "Failed" must empty the list.
    await sheet.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Failed", exact: true }).click();
    await sheet.getByRole("button", { name: "Apply filters" }).click();

    await expect(page).toHaveURL(/[?&]paymentStatus=FAILED(&|$)/);
    await expect(page).toHaveURL(/[?&]page=1(&|$)/);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("active-filter-count")).toHaveText("1 active");
    await expect(page.getByTestId("transactions-empty")).toContainText("No transactions match your filters.");
    await expect(page.getByTestId("transaction-cards")).toHaveCount(0);

    // Clearing drops the filter from the URL and brings the bill back.
    await page.getByTestId("transactions-empty").getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/paymentStatus=/);
    await expect(
      page.getByTestId("transaction-cards").getByRole("button", { name: new RegExp(sale.transaction.billNumber) }),
    ).toBeVisible();
    await expect(page.getByTestId("active-filter-count")).toHaveCount(0);
  });

  test("tapping a row opens the bill in a sheet with a stacked item list", async ({ page, request }) => {
    await createVendorSession(page, request, "tx-phone-detail");
    const sale = await ringUpSale(page);
    await openTransactions(page, PHONE);

    await page
      .getByTestId("transaction-cards")
      .getByRole("button", { name: new RegExp(sale.transaction.billNumber) })
      .click();

    const detail = page.getByRole("dialog", { name: sale.transaction.billNumber });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("table")).toHaveCount(0);

    const items = detail.getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Samosa");
    await expect(items.first()).toContainText("2 × ₹20.00");
    await expect(items.first()).toContainText("₹40.00");
    await expect(detail.getByText("Paid", { exact: true })).toBeVisible();

    // A bottom sheet: full width, flush with the bottom of the screen.
    const box = await detail.boundingBox();
    expect(box).not.toBeNull();
    // (A few px of slack on the width for a desktop-browser scrollbar gutter.)
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(PHONE.width - 20);
    await expect
      .poll(async () => {
        const b = await detail.boundingBox();
        return b ? Math.round(b.y + b.height) : null;
      }, { message: "sheet settles flush with the bottom edge" })
      .toBe(PHONE.height);

    // Both actions are there, at 44px.
    const print = detail.getByRole("link", { name: "Print receipt" });
    await expect(print).toBeVisible();
    await expect(print).toHaveAttribute("href", new RegExp(`/receipts/${sale.transaction.billNumber}`));
    // A disabled button while the receipt text loads, a wa.me link once it has.
    const whatsapp = detail.getByRole("link", { name: "Send on WhatsApp" });
    await expect(whatsapp).toBeVisible({ timeout: 20_000 });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/(wa\.me|api\.whatsapp\.com)\//);
    for (const [label, action] of [
      ["Print receipt", print],
      ["Send on WhatsApp", whatsapp],
    ] as const) {
      const actionBox = await action.boundingBox();
      expect(actionBox, `${label} laid out`).not.toBeNull();
      expect(Math.round(actionBox!.height), `${label} height`).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });
});

test.describe("transactions — desktop", () => {
  test("the table and the inline filter row are shown, the card list is not", async ({ page, request }) => {
    await createVendorSession(page, request, "tx-desktop");
    const sale = await ringUpSale(page);
    await openTransactions(page, DESKTOP);

    await expect(page.getByTestId("transactions-table")).toBeVisible();
    await expect(page.getByTestId("transaction-cards")).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Bill #" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();

    // Inline filters, no Filters button.
    await expect(page.getByLabel("From")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

    // The bill is listed once to assistive tech, and opens the same detail.
    const row = page.getByRole("button", { name: new RegExp(sale.transaction.billNumber) });
    await expect(row).toHaveCount(1);
    await row.click();
    const detail = page.getByRole("dialog", { name: sale.transaction.billNumber });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("listitem").first()).toContainText("2 × ₹20.00");
  });
});
