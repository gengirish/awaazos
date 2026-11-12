import { expect, test, type Page } from "@playwright/test";

import { billLineCosts, CAN_SET_BILLING, setStaffRole } from "./helpers/billing-db";
import { createMenuItem, createVendorSession, type MenuItemRow, type TransactionCreated } from "./helpers/vendor";

type CostRow = MenuItemRow & { costInPaise: number | null };
type SizedRow = CostRow & { variants: { id: string; label: string; costInPaise: number | null }[] };

async function menuRow(page: Page, id: string): Promise<SizedRow | undefined> {
  const list = await page.request.get("/api/menu");
  expect(list.status()).toBe(200);
  return ((await list.json()) as { data: SizedRow[] }).data.find((i) => i.id === id);
}

/** Cost price (lib/item-cost.ts): optional, for MANAGER and up, kept on each bill line. */
test.describe("cost price", () => {
  test("owner records a cost in the item form and the card shows the margin", async ({ page, request }) => {
    await createVendorSession(page, request, "cost-ui");
    const item = await createMenuItem(page, { name: "Block Print Kurti", priceInRupees: 599 });

    await page.goto("/menu");
    // No cost recorded: the card says nothing about it.
    await expect(page.getByText(/Margin/)).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Block Print Kurti" }).click();
    const cost = page.getByLabel("Cost price (₹, optional)");
    await cost.fill("12.345");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Use at most 2 decimal places")).toBeVisible();

    await cost.fill("250");
    // The hint works the margin out before saving.
    await expect(page.getByRole("dialog").getByText("Cost ₹250.00 · Margin ₹349.00")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Cost ₹250.00 · Margin ₹349.00")).toBeVisible();
    expect((await menuRow(page, item.id))?.costInPaise).toBe(25000);

    // Blank clears it.
    await page.getByRole("button", { name: "Edit Block Print Kurti" }).click();
    await page.getByLabel("Cost price (₹, optional)").fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Margin/)).toHaveCount(0);
    expect((await menuRow(page, item.id))?.costInPaise).toBeNull();
  });

  test("cost API: create, change, clear and its errors", async ({ page, request }) => {
    await createVendorSession(page, request, "cost-api");
    const created = await page.request.post("/api/menu", {
      data: { name: "Linen Shirt", priceInRupees: 899, costInRupees: 420.5 },
    });
    expect(created.status()).toBe(201);
    const item = (await created.json()).data as CostRow;
    expect(item.costInPaise).toBe(42050);

    for (const bad of [-1, 1.234, "400", 100000.01]) {
      const res = await page.request.patch(`/api/menu/${item.id}`, { data: { costInRupees: bad } });
      expect(res.status(), JSON.stringify(bad)).toBe(400);
    }

    // A cost alone is a valid update; 0 is a cost, null clears it.
    const zero = await page.request.patch(`/api/menu/${item.id}`, { data: { costInRupees: 0 } });
    expect(zero.status()).toBe(200);
    expect((await zero.json()).data.costInPaise).toBe(0);
    const cleared = await page.request.patch(`/api/menu/${item.id}`, { data: { costInRupees: null } });
    expect((await cleared.json()).data.costInPaise).toBeNull();
  });

  test.describe("by role and on bills", () => {
    test.skip(!CAN_SET_BILLING, "needs a local database to change the staff role and read bill lines");

    test("a cashier never sees a cost and cannot change one", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "cost-cashier");
      const created = await page.request.post("/api/menu", {
        data: { name: "Silk Dupatta", priceInRupees: 450, costInRupees: 200 },
      });
      const item = (await created.json()).data as CostRow;
      const sizes = await page.request.put(`/api/menu/${item.id}/variants`, {
        data: { variants: [{ label: "Red", costInRupees: 220 }, { label: "Blue" }] },
      });
      expect(sizes.status()).toBe(200);
      expect(((await sizes.json()).data as { costInPaise: number | null }[]).map((v) => v.costInPaise)).toEqual([
        22000,
        null,
      ]);

      await setStaffRole(creds.email, "CASHIER");

      const row = (await menuRow(page, item.id))!;
      expect(row.costInPaise).toBeNull();
      expect(row.variants.map((v) => v.costInPaise)).toEqual([null, null]);

      // Sending one is ignored, not refused: the rest of the update still saves.
      const patch = await page.request.patch(`/api/menu/${item.id}`, {
        data: { name: "Silk Dupatta 2", costInRupees: 1 },
      });
      expect(patch.status()).toBe(200);
      expect((await patch.json()).data).toMatchObject({ name: "Silk Dupatta 2", costInPaise: null });
      const put = await page.request.put(`/api/menu/${item.id}/variants`, {
        data: { variants: row.variants.map((v) => ({ id: v.id, label: v.label, costInRupees: 1 })) },
      });
      expect(put.status()).toBe(200);

      await page.goto("/menu");
      await expect(page.getByText("Silk Dupatta 2")).toBeVisible();
      await expect(page.getByText(/Margin/)).toHaveCount(0);
      await page.getByRole("button", { name: "Edit Silk Dupatta 2" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByLabel("Cost price (₹, optional)")).toHaveCount(0);

      // Back as the owner: nothing the cashier sent changed a cost.
      await setStaffRole(creds.email, "OWNER");
      const ownerRow = (await menuRow(page, item.id))!;
      expect(ownerRow.costInPaise).toBe(20000);
      expect(ownerRow.variants.map((v) => v.costInPaise)).toEqual([22000, null]);
    });

    test("a counter sale keeps each line's cost of that moment", async ({ page, request }) => {
      await createVendorSession(page, request, "cost-sale");
      const withCost = await page.request.post("/api/menu", {
        data: { name: "Cost Tee", priceInRupees: 300, costInRupees: 120 },
      });
      const tee = (await withCost.json()).data as CostRow;
      const plain = await createMenuItem(page, { name: "No Cost Cap", priceInRupees: 100 });

      const sale = await page.request.post("/api/transactions", {
        data: {
          items: [
            { menuItemId: tee.id, name: tee.name, priceInPaise: 30000, qty: 2 },
            { menuItemId: plain.id, name: plain.name, priceInPaise: 10000, qty: 1 },
          ],
          subtotalPaise: 70000,
          taxPaise: 0,
          totalPaise: 70000,
          paymentMethod: "CASH",
          source: "MANUAL",
        },
      });
      expect(sale.status()).toBe(201);
      const bill = ((await sale.json()) as TransactionCreated).transaction.id;
      expect(await billLineCosts(bill)).toEqual({ "Cost Tee": 12000, "No Cost Cap": null });

      // Changing the cost afterwards leaves the bill as it was.
      await page.request.patch(`/api/menu/${tee.id}`, { data: { costInRupees: 500 } });
      expect((await billLineCosts(bill))["Cost Tee"]).toBe(12000);
    });
  });
});
