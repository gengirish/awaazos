import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, type TransactionCreated } from "./helpers/vendor";

/**
 * Receipt module: WhatsApp text, staff print page (/receipts/[bill]) and the
 * public customer page (/r/[token]). The public page must never show the
 * customer's phone or name, even though the sale carries them.
 */

const CUSTOMER_PHONE = "+919812345678";
const CUSTOMER_NAME = "Receipt Privacy Probe";

async function ringUpSale(page: Page): Promise<TransactionCreated> {
  const item = await createMenuItem(page, { name: "Receipt Masala Dosa", priceInRupees: 60 });
  const res = await page.request.post("/api/transactions", {
    data: {
      items: [{ menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 2 }],
      subtotalPaise: 12000,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 12000,
      paymentMethod: "UPI",
      source: "MANUAL",
      customerPhone: CUSTOMER_PHONE,
      customerName: CUSTOMER_NAME,
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as TransactionCreated;
}

async function receiptMessage(page: Page, transactionId: string) {
  const res = await page.request.get(`/api/receipts/message?transactionId=${encodeURIComponent(transactionId)}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { text: string; receiptUrl: string | null } }).data;
}

test.describe("receipts", () => {
  test("message links a public receipt page that carries no customer PII", async ({ page, request, browser }) => {
    await createVendorSession(page, request, "rcpt");
    const sale = await ringUpSale(page);

    const msg = await receiptMessage(page, sale.transaction.id);
    expect(msg.text).toContain(sale.transaction.billNumber);
    expect(msg.text).toContain("Paid · UPI");
    expect(msg.text).not.toContain(CUSTOMER_PHONE);
    expect(msg.receiptUrl).toMatch(/\/r\/[A-Za-z0-9_-]{32}$/);
    expect(msg.text).toContain(`View receipt: ${msg.receiptUrl}`);

    // Same link on a second fetch: the token is stable once minted.
    expect((await receiptMessage(page, sale.transaction.id)).receiptUrl).toBe(msg.receiptUrl);

    // Open it signed out. Use the path only: the absolute origin comes from env.
    const anon = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const anonPage = await anon.newPage();
      const res = await anonPage.goto(new URL(msg.receiptUrl!).pathname);
      expect(res?.status()).toBe(200);
      const receipt = anonPage.getByRole("article", { name: `Receipt ${sale.transaction.billNumber}` });
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText("Receipt Masala Dosa");
      await expect(receipt).toContainText("₹120.00");
      const html = await anonPage.content();
      expect(html).not.toContain(CUSTOMER_PHONE);
      expect(html).not.toContain("9812345678");
      expect(html).not.toContain(CUSTOMER_NAME);
      await expect(anonPage.getByRole("button", { name: /print or save as pdf/i })).toBeVisible();
    } finally {
      await anon.close();
    }
  });

  test("unknown receipt token is a 404", async ({ page }) => {
    const res = await page.goto("/r/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaa");
    expect(res?.status()).toBe(404);
  });

  test("print page renders the bill at the chosen paper width", async ({ page, request }) => {
    await createVendorSession(page, request, "rcpt-print");
    const sale = await ringUpSale(page);
    const bill = sale.transaction.billNumber;

    const res = await page.goto(`/receipts/${bill}?paper=MM58`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("article", { name: `Receipt ${bill}` })).toContainText("Paid · UPI");
    await expect(page.getByRole("link", { name: "58 mm thermal" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(page.locator("main#main")).toHaveClass(/receipt-page-mm58/);
  });

  test("receipt settings: GSTIN is validated and printed on receipts", async ({ page, request }) => {
    await createVendorSession(page, request, "rcpt-settings");

    const bad = await page.request.patch("/api/vendor", {
      data: { gstin: "NOT-A-GSTIN" },
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status()).toBe(400);

    const ok = await page.request.patch("/api/vendor", {
      data: { gstin: "36abcde1234f1z5", receiptFooter: "Phir milenge!", receiptPaper: "A4" },
      headers: { "Content-Type": "application/json" },
    });
    expect(ok.status()).toBe(200);

    const sale = await ringUpSale(page);
    const msg = await receiptMessage(page, sale.transaction.id);
    expect(msg.text).toContain("GSTIN: 36ABCDE1234F1Z5");
    expect(msg.text).toContain("Phir milenge!");

    await page.goto("/settings/receipts");
    await expect(page.getByRole("heading", { level: 1, name: "Receipts" })).toBeVisible();
    await expect(page.getByLabel("GSTIN")).toHaveValue("36ABCDE1234F1Z5");
    await expect(page.getByRole("radio", { name: "A4 / Letter" })).toBeChecked();
    await expect(page.getByRole("figure")).toContainText("Phir milenge!");
  });
});
