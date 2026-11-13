import { expect, test, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setStaffRole } from "./helpers/billing-db";
import { createMenuItem, createVendorSession, type MenuItemRow } from "./helpers/vendor";

type Size = { id: string; label: string; stockLeft: number | null; costInPaise: number | null };
type Row = MenuItemRow & {
  stockQty: number | null;
  stockLeft: number | null;
  costInPaise: number | null;
  variants: Size[];
};
type Purchase = { variantLabel: string | null; qty: number; unitCostInPaise: number | null };

async function menuRow(page: Page, id: string): Promise<Row> {
  const list = await page.request.get("/api/menu");
  expect(list.status()).toBe(200);
  return ((await list.json()) as { data: Row[] }).data.find((i) => i.id === id)!;
}

async function purchases(page: Page, id: string): Promise<Purchase[]> {
  const res = await page.request.get(`/api/menu/${id}/purchases`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: Purchase[] }).data;
}

/** "Received stock" (lib/stock-purchase.ts): adds to the count and keeps a dated purchase with its cost. */
test.describe("stock purchases", () => {
  test("owner records received stock from the card; count, cost and the form's list follow", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "purchase-ui");
    const item = await createMenuItem(page, { name: "Rose Candle", priceInRupees: 299 });

    await page.goto("/menu");
    // Stock is not tracked yet: nothing to receive into.
    await expect(page.getByRole("button", { name: "Received stock for Rose Candle" })).toHaveCount(0);

    const tracked = await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: 5, costInRupees: 100 } });
    expect(tracked.status()).toBe(200);
    await page.reload();

    await page.getByRole("button", { name: "Received stock for Rose Candle" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Received stock" })).toBeVisible();
    // The cost on record is filled in.
    await expect(dialog.getByLabel("Cost of each (₹, optional)")).toHaveValue("100");

    await dialog.getByRole("button", { name: "Add to stock" }).click();
    await expect(dialog.getByText("Enter how many came in")).toBeVisible();

    await dialog.getByLabel("How many came in?").fill("10");
    await dialog.getByLabel("Cost of each (₹, optional)").fill("120");
    await expect(dialog.getByText("10 for ₹1,200.00 in all.")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to stock" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Cost ₹120.00 · Margin ₹179.00")).toBeVisible();
    await expect(page.getByText("15 in stock")).toBeVisible();
    expect(await menuRow(page, item.id)).toMatchObject({ stockQty: 15, stockLeft: 15, costInPaise: 12000 });
    expect(await purchases(page, item.id)).toMatchObject([{ variantLabel: null, qty: 10, unitCostInPaise: 12000 }]);

    await page.getByRole("button", { name: "Edit Rose Candle" }).click();
    await expect(page.getByRole("dialog").getByText(/· 10 received · ₹120\.00 each/)).toBeVisible();
  });

  test("an item with sizes is received by size in one save", async ({ page, request }) => {
    await createVendorSession(page, request, "purchase-sizes");
    const created = await page.request.post("/api/menu", {
      data: { name: "Cotton Kurti", priceInRupees: 599, costInRupees: 250 },
    });
    const item = (await created.json()).data as MenuItemRow;
    const put = await page.request.put(`/api/menu/${item.id}/variants`, {
      data: { variants: [{ label: "M", stockQty: 2 }, { label: "L", stockQty: 1 }, { label: "XL" }] },
    });
    expect(put.status()).toBe(200);

    await page.goto("/menu");
    await page.getByRole("button", { name: "Received stock for Cotton Kurti" }).click();
    const dialog = page.getByRole("dialog");
    // Only the sizes whose stock is counted are offered.
    await expect(dialog.getByLabel("XL", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("M", { exact: true }).fill("4");
    await dialog.getByLabel("L", { exact: true }).fill("6");
    await dialog.getByLabel("Cost of each (₹, optional)").fill("275");
    await expect(dialog.getByText("10 for ₹2,750.00 in all.")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to stock" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const row = await menuRow(page, item.id);
    expect(row.costInPaise).toBe(27500);
    expect(row.variants.map((v) => [v.label, v.stockLeft])).toEqual([
      ["M", 6],
      ["L", 7],
      ["XL", null],
    ]);
    expect(await purchases(page, item.id)).toMatchObject([
      { variantLabel: "L", qty: 6, unitCostInPaise: 27500 },
      { variantLabel: "M", qty: 4, unitCostInPaise: 27500 },
    ]);
  });

  test("purchase API: refusals leave stock and cost alone", async ({ page, request }) => {
    await createVendorSession(page, request, "purchase-api");
    const item = await createMenuItem(page, { name: "Plain Scarf", priceInRupees: 199 });
    const url = `/api/menu/${item.id}/purchases`;

    const untracked = await page.request.post(url, { data: { lines: [{ qty: 3 }] } });
    expect(untracked.status()).toBe(409);
    expect((await untracked.json()).error).toBe("stock_not_tracked");

    await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: 4 } });
    for (const bad of [{}, { lines: [] }, { lines: [{ qty: 0 }] }, { lines: [{ qty: 2 }], costInRupees: -5 }]) {
      const res = await page.request.post(url, { data: bad });
      expect(res.status(), JSON.stringify(bad)).toBe(400);
    }
    const noSuchSize = await page.request.post(url, { data: { lines: [{ variantId: "nope", qty: 1 }] } });
    expect(noSuchSize.status()).toBe(404);
    const noSuchItem = await page.request.post("/api/menu/nope/purchases", { data: { lines: [{ qty: 1 }] } });
    expect(noSuchItem.status()).toBe(404);

    expect(await menuRow(page, item.id)).toMatchObject({ stockLeft: 4, costInPaise: null });
    expect(await purchases(page, item.id)).toEqual([]);

    // No cost given and none on record: the purchase says so.
    const ok = await page.request.post(url, { data: { lines: [{ qty: 6 }] } });
    expect(ok.status()).toBe(201);
    expect(await menuRow(page, item.id)).toMatchObject({ stockLeft: 10, costInPaise: null });
    expect(await purchases(page, item.id)).toMatchObject([{ qty: 6, unitCostInPaise: null }]);
  });

  test.describe("by role", () => {
    test.skip(!CAN_SET_BILLING, "needs a local database to change the staff role");

    test("a cashier cannot record or read purchases, and keeps the +1 button", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "purchase-cashier");
      const item = await createMenuItem(page, { name: "Silk Stole", priceInRupees: 450 });
      await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: 3, costInRupees: 200 } });
      await page.request.post(`/api/menu/${item.id}/purchases`, { data: { lines: [{ qty: 2 }] } });

      await setStaffRole(creds.email, "CASHIER");
      const post = await page.request.post(`/api/menu/${item.id}/purchases`, {
        data: { lines: [{ qty: 5 }], costInRupees: 1 },
      });
      expect(post.status()).toBe(403);
      expect((await page.request.get(`/api/menu/${item.id}/purchases`)).status()).toBe(403);

      await page.goto("/menu");
      await expect(page.getByRole("button", { name: "One more Silk Stole" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Received stock for Silk Stole" })).toHaveCount(0);

      await setStaffRole(creds.email, "OWNER");
      expect(await menuRow(page, item.id)).toMatchObject({ stockLeft: 5, costInPaise: 20000 });
      expect(await purchases(page, item.id)).toHaveLength(1);
    });
  });
});
