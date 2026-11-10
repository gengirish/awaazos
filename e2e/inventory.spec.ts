import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, type MenuItemRow } from "./helpers/vendor";

type StockRow = MenuItemRow & { stockQty: number | null; stockLeft: number | null; lowStockAt: number | null };

async function menuRow(page: Page, id: string): Promise<StockRow | undefined> {
  const list = await page.request.get("/api/menu");
  expect(list.status()).toBe(200);
  return ((await list.json()) as { data: StockRow[] }).data.find((i) => i.id === id);
}

/** Stock for everyday items (lib/inventory.ts, lib/menu-stock.ts). */
test.describe("inventory", () => {
  test("seller turns on stock for an item, steps it and sets a count", async ({ page, request }) => {
    await createVendorSession(page, request, "inventory-ui");
    const item = await createMenuItem(page, { name: "Cotton Tee", priceInRupees: 499 });

    await page.goto("/menu");
    // Untracked: no stock controls on the card.
    await expect(page.getByRole("button", { name: "One more Cotton Tee" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Cotton Tee" }).click();
    await page.getByRole("switch", { name: "Track stock" }).click();
    await page.getByLabel("In stock now").fill("5");
    await page.getByLabel(/Warn me when this many are left/).fill("3");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("5 in stock", { exact: true })).toBeVisible();
    const tracked = await menuRow(page, item.id);
    expect(tracked).toMatchObject({ stockQty: 5, stockLeft: 5, lowStockAt: 3 });

    await page.getByRole("button", { name: "One more Cotton Tee" }).click();
    await expect(page.getByText("6 in stock", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "One less Cotton Tee" }).click();
    await expect(page.getByText("5 in stock", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "One less Cotton Tee" }).click();
    await page.getByRole("button", { name: "One less Cotton Tee" }).click();
    // At the warning line the label says so in words, not only in colour.
    await expect(page.getByText("Low: 3 left", { exact: true })).toBeVisible();
    await expect.poll(async () => (await menuRow(page, item.id))?.stockLeft).toBe(3);

    await page.getByRole("button", { name: "Set stock count for Cotton Tee" }).click();
    await page.getByLabel("How many do you have now?").fill("0");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Sold out", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "One less Cotton Tee" })).toBeDisabled();
    expect((await menuRow(page, item.id))?.stockLeft).toBe(0);
  });

  test("stock API: set, adjust, stop tracking and its errors", async ({ page, request }) => {
    await createVendorSession(page, request, "inventory-api");
    const item = await createMenuItem(page, { name: "Silk Scarf", priceInRupees: 299 });

    // Untracked: adjust has nothing to move.
    const untracked = await page.request.post(`/api/menu/${item.id}/stock`, { data: { adjust: 1 } });
    expect(untracked.status()).toBe(409);
    expect(await untracked.json()).toMatchObject({ error: "stock_not_tracked" });

    for (const bad of [{}, { set: -1 }, { set: 1.5 }, { adjust: 0 }, { set: 1, adjust: 1 }]) {
      const res = await page.request.post(`/api/menu/${item.id}/stock`, { data: bad });
      expect(res.status(), JSON.stringify(bad)).toBe(400);
    }

    const set = await page.request.post(`/api/menu/${item.id}/stock`, { data: { set: 10 } });
    expect(set.status()).toBe(200);
    expect((await set.json()).data).toEqual({ stockQty: 10, stockLeft: 10, lowStockAt: null });

    const received = await page.request.post(`/api/menu/${item.id}/stock`, { data: { adjust: 5 } });
    expect((await received.json()).data).toMatchObject({ stockQty: 15, stockLeft: 15 });

    // Never recorded below 0.
    const damaged = await page.request.post(`/api/menu/${item.id}/stock`, { data: { adjust: -20 } });
    expect((await damaged.json()).data).toMatchObject({ stockQty: 0, stockLeft: 0 });

    // PATCH takes the same keys beside (or without) the item fields.
    const patch = await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: 7, lowStockAt: 2 } });
    expect(patch.status()).toBe(200);
    expect((await patch.json()).data).toMatchObject({ stockQty: 7, stockLeft: 7, lowStockAt: 2 });

    const badPatch = await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: -3 } });
    expect(badPatch.status()).toBe(400);

    const stop = await page.request.patch(`/api/menu/${item.id}`, { data: { stockQty: null } });
    expect(stop.status()).toBe(200);
    expect((await stop.json()).data).toMatchObject({ stockQty: null, stockLeft: null });

    // Created with a count: tracked from the start.
    const created = await page.request.post("/api/menu", {
      data: { name: "Linen Kurta", priceInRupees: 899, stockQty: 4, lowStockAt: 1 },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).data).toMatchObject({ stockQty: 4, stockLeft: 4, lowStockAt: 1 });
  });
});
