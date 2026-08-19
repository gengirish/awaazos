import { expect, test } from "@playwright/test";

import {
  createMenuItem,
  createVendorSession,
  redisConfigured,
  type TransactionCreated,
} from "./helpers/vendor";

const BILL_NUMBER = /^AWZ-\d{8}-\d{4}$/;

/** Build a well-formed, internally consistent cart body. */
function cartBody(
  items: { menuItemId: string; name: string; priceInPaise: number; qty: number }[],
  overrides: Partial<{
    subtotalPaise: number;
    discountPaise: number;
    taxPaise: number;
    totalPaise: number;
  }> = {},
) {
  const subtotalPaise = items.reduce((s, i) => s + i.priceInPaise * i.qty, 0);
  const discountPaise = 0;
  const taxPaise = 0;
  return {
    items,
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalPaise: subtotalPaise - discountPaise + taxPaise,
    paymentMethod: "CASH",
    source: "MANUAL",
    ...overrides,
  };
}

test.describe("POS transaction + atomic billing", () => {
  test("records a sale, mints an AWZ bill number, keeps totals in integer paise", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pos");
    const samosa = await createMenuItem(page, { name: "Samosa", priceInRupees: 15 });
    const chai = await createMenuItem(page, { name: "Chai", priceInRupees: 10 });

    const items = [
      { menuItemId: samosa.id, name: samosa.name, priceInPaise: samosa.priceInPaise, qty: 2 },
      { menuItemId: chai.id, name: chai.name, priceInPaise: chai.priceInPaise, qty: 1 },
    ];

    const res = await page.request.post("/api/transactions", {
      data: cartBody(items),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);

    const body = (await res.json()) as TransactionCreated;
    expect(body.transaction.billNumber).toMatch(BILL_NUMBER);
    // 1500×2 + 1000 = 4000 paise = ₹40.00
    expect(body.transaction.totalPaise).toBe(4000);
    expect(body.transaction.paymentStatus).toBe("PAID"); // CASH settles immediately
    expect(body.receiptNumber).toBe(body.transaction.billNumber);
  });

  test("bill sequence increments within the same IST day", async ({ page, request }) => {
    await createVendorSession(page, request, "pos-seq");
    const item = await createMenuItem(page, { name: "Vada Pav", priceInRupees: 20 });
    const items = [
      { menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 1 },
    ];

    const first = await page.request.post("/api/transactions", {
      data: cartBody(items),
      headers: { "Content-Type": "application/json" },
    });
    const second = await page.request.post("/api/transactions", {
      data: cartBody(items),
      headers: { "Content-Type": "application/json" },
    });
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);

    const a = (await first.json()) as TransactionCreated;
    const b = (await second.json()) as TransactionCreated;

    const seqOf = (bill: string) => Number(bill.slice(-4));
    expect(a.transaction.billNumber).toMatch(BILL_NUMBER);
    expect(b.transaction.billNumber).toMatch(BILL_NUMBER);
    expect(seqOf(b.transaction.billNumber)).toBe(seqOf(a.transaction.billNumber) + 1);
    expect(a.transaction.billNumber).not.toBe(b.transaction.billNumber);
  });

  test("rejects a client-tampered subtotal and a tampered total", async ({ page, request }) => {
    await createVendorSession(page, request, "pos-tamper");
    const item = await createMenuItem(page, { name: "Lassi", priceInRupees: 40 });
    const items = [
      { menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 2 },
    ];

    // Claim a cheaper subtotal than the line items actually sum to.
    const badSubtotal = await page.request.post("/api/transactions", {
      data: cartBody(items, { subtotalPaise: 100, totalPaise: 100 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(badSubtotal.status()).toBe(400);
    expect(((await badSubtotal.json()) as { code?: string }).code).toBe("subtotal_mismatch");

    // Correct subtotal, but a total that does not equal subtotal − discount + tax.
    const badTotal = await page.request.post("/api/transactions", {
      data: cartBody(items, { totalPaise: 1 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(badTotal.status()).toBe(400);
    expect(((await badTotal.json()) as { code?: string }).code).toBe("total_mismatch");
  });

  test("replaying an Idempotency-Key returns the original bill, not a new one", async ({
    page,
    request,
  }) => {
    test.skip(
      !(await redisConfigured(request)),
      "idempotency needs Upstash KV — /api/ready reports redis down",
    );

    await createVendorSession(page, request, "pos-idem");
    const item = await createMenuItem(page, { name: "Jalebi", priceInRupees: 25 });
    const items = [
      { menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 1 },
    ];
    const key = `e2e-idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const send = () =>
      page.request.post("/api/transactions", {
        data: cartBody(items),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      });

    const first = await send();
    expect(first.status()).toBe(201);
    const second = await send();

    // A replay returns the stored 201 body; an in-flight duplicate returns 409.
    expect([201, 409]).toContain(second.status());
    if (second.status() === 201) {
      const a = (await first.json()) as TransactionCreated;
      const b = (await second.json()) as TransactionCreated;
      expect(b.transaction.billNumber, "double-tap must not mint a second bill").toBe(
        a.transaction.billNumber,
      );
    }
  });

  test("transaction list returns the vendor's own sales with pagination fields", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "pos-list");
    const item = await createMenuItem(page, { name: "Idli", priceInRupees: 30 });
    const items = [
      { menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 1 },
    ];

    const created = await page.request.post("/api/transactions", {
      data: cartBody(items),
      headers: { "Content-Type": "application/json" },
    });
    const createdBody = (await created.json()) as TransactionCreated;

    const list = await page.request.get("/api/transactions");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      items: { id: string; billNumber: string }[];
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };

    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.page).toBe(1);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.items.some((t) => t.billNumber === createdBody.transaction.billNumber)).toBe(true);
  });
});
