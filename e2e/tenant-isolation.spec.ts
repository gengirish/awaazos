import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  CONTEXT_OPTIONS,
  createMenuItem,
  createVendorSession,
  type MenuItemRow,
  type TransactionCreated,
} from "./helpers/vendor";

/**
 * Enforces `.cursor/rules/tenant-isolation.mdc`:
 *
 *   "A staff member of Vendor A must never be able to read or write Vendor B's
 *    data even if they construct a request with B's IDs."
 *   "Asserts 404 (not 403) — don't leak existence."
 *
 * Every mutation route uses a compound `where: { id, vendorId }`, so a forged
 * ID resolves to zero rows and Prisma raises P2025 → 404.
 */
test.describe("tenant isolation", () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeEach(async ({ browser, request }) => {
    ctxA = await browser.newContext(CONTEXT_OPTIONS);
    ctxB = await browser.newContext(CONTEXT_OPTIONS);
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();

    await createVendorSession(pageA, request, "iso-a");
    await createVendorSession(pageB, request, "iso-b");
  });

  test.afterEach(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test("vendor B cannot update or delete vendor A's menu item (404, not 403)", async () => {
    const itemA = await createMenuItem(pageA, { name: "A Secret Samosa", priceInRupees: 15 });

    const patch = await pageB.request.patch(`/api/menu/${itemA.id}`, {
      data: { name: "hijacked" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.status(), "cross-tenant PATCH must 404, never 403").toBe(404);

    const del = await pageB.request.delete(`/api/menu/${itemA.id}`);
    expect(del.status(), "cross-tenant DELETE must 404, never 403").toBe(404);

    // A's item must be untouched by B's attempts.
    const listA = await pageA.request.get("/api/menu");
    const bodyA = (await listA.json()) as { data: MenuItemRow[] };
    const stillThere = bodyA.data.find((i) => i.id === itemA.id);
    expect(stillThere?.name).toBe("A Secret Samosa");
    expect(stillThere?.isAvailable).toBe(true);
  });

  test("vendor B's menu listing never contains vendor A's items", async () => {
    const itemA = await createMenuItem(pageA, { name: "A Only Chai", priceInRupees: 10 });
    await createMenuItem(pageB, { name: "B Only Coffee", priceInRupees: 20 });

    const listB = await pageB.request.get("/api/menu");
    const bodyB = (await listB.json()) as { data: MenuItemRow[] };

    expect(bodyB.data.some((i) => i.id === itemA.id)).toBe(false);
    expect(bodyB.data.some((i) => i.name === "A Only Chai")).toBe(false);
    expect(bodyB.data.some((i) => i.name === "B Only Coffee")).toBe(true);
  });

  test("vendor B's transaction list never contains vendor A's sales", async () => {
    const itemA = await createMenuItem(pageA, { name: "A Vada", priceInRupees: 20 });
    const saleA = await pageA.request.post("/api/transactions", {
      data: {
        items: [
          { menuItemId: itemA.id, name: itemA.name, priceInPaise: itemA.priceInPaise, qty: 1 },
        ],
        subtotalPaise: 2000,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: 2000,
        paymentMethod: "CASH",
        source: "MANUAL",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(saleA.status()).toBe(201);
    const saleABody = (await saleA.json()) as TransactionCreated;

    const listB = await pageB.request.get("/api/transactions");
    expect(listB.status()).toBe(200);
    const bodyB = (await listB.json()) as { items: { billNumber: string }[]; total: number };

    expect(bodyB.items.some((t) => t.billNumber === saleABody.transaction.billNumber)).toBe(false);
    expect(bodyB.total).toBe(0);
  });

  test("vendor B cannot read vendor A's receipt (404, not 403)", async () => {
    const itemA = await createMenuItem(pageA, { name: "A Receipt Idli", priceInRupees: 30 });
    const saleA = await pageA.request.post("/api/transactions", {
      data: {
        items: [{ menuItemId: itemA.id, name: itemA.name, priceInPaise: itemA.priceInPaise, qty: 1 }],
        subtotalPaise: 3000,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: 3000,
        paymentMethod: "CASH",
        source: "MANUAL",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(saleA.status()).toBe(201);
    const { transaction } = (await saleA.json()) as TransactionCreated;

    const msg = await pageB.request.get(`/api/receipts/message?transactionId=${transaction.id}`);
    expect(msg.status(), "cross-tenant receipt text must 404").toBe(404);

    // B has no sales yet, so A's bill number matches nothing of B's.
    const print = await pageB.goto(`/receipts/${transaction.billNumber}`);
    expect(print?.status(), "cross-tenant print page must 404").toBe(404);
  });

  test("each vendor's bill sequence is independent", async () => {
    const itemA = await createMenuItem(pageA, { name: "A Item", priceInRupees: 10 });
    const itemB = await createMenuItem(pageB, { name: "B Item", priceInRupees: 10 });

    const mk = (page: Page, item: MenuItemRow) =>
      page.request.post("/api/transactions", {
        data: {
          items: [
            { menuItemId: item.id, name: item.name, priceInPaise: item.priceInPaise, qty: 1 },
          ],
          subtotalPaise: 1000,
          discountPaise: 0,
          taxPaise: 0,
          totalPaise: 1000,
          paymentMethod: "CASH",
          source: "MANUAL",
        },
        headers: { "Content-Type": "application/json" },
      });

    const resA = await mk(pageA, itemA);
    const resB = await mk(pageB, itemB);
    const a = (await resA.json()) as TransactionCreated;
    const b = (await resB.json()) as TransactionCreated;

    // BillSequence is keyed (vendorId, date) — both vendors start at 0001 the
    // same day rather than sharing a counter.
    expect(a.transaction.billNumber.slice(-4)).toBe("0001");
    expect(b.transaction.billNumber.slice(-4)).toBe("0001");
  });
});
