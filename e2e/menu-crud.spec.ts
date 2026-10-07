import { expect, test } from "@playwright/test";

import {
  createMenuItem,
  createVendorSession,
  type MenuItemRow,
} from "./helpers/vendor";

test.describe("menu CRUD", () => {
  test("create → list → update → soft-delete, with rupee→paise conversion", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "menu");

    // ₹24.50 must land as the integer 2450, never 24.5 or 2449.
    const created = await createMenuItem(page, {
      name: "Bhel Puri",
      priceInRupees: 24.5,
      aliasesCsv: "bhel, bhelpuri",
      category: "Chaat",
    });
    expect(created.priceInPaise).toBe(2450);
    expect(Number.isInteger(created.priceInPaise)).toBe(true);

    const list = await page.request.get("/api/menu");
    expect(list.status()).toBe(200);
    const listed = (await list.json()) as { data: MenuItemRow[] };
    expect(listed.data.some((i) => i.id === created.id)).toBe(true);

    const patch = await page.request.patch(`/api/menu/${created.id}`, {
      data: { priceInRupees: 30 },
      headers: { "Content-Type": "application/json" },
    });
    expect(patch.status()).toBe(200);
    const patched = (await patch.json()) as { data: MenuItemRow };
    expect(patched.data.priceInPaise).toBe(3000);

    // DELETE is a soft delete — the row must survive so historical bills that
    // reference it keep resolving.
    const del = await page.request.delete(`/api/menu/${created.id}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    const after = await page.request.get("/api/menu");
    const afterBody = (await after.json()) as { data: MenuItemRow[] };
    const row = afterBody.data.find((i) => i.id === created.id);
    expect(row, "soft delete must keep the row").toBeTruthy();
    expect(row?.isAvailable).toBe(false);
  });

  test("rejects prices that cannot be represented as integer paise", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "menu-invalid");

    for (const priceInRupees of [0, -5, 24.555]) {
      const res = await page.request.post("/api/menu", {
        data: { name: `Bad ${priceInRupees}`, priceInRupees },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status(), `price ${priceInRupees} must be rejected`).toBe(400);
    }
  });

  test("menu page renders an item created through the API", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-ui");
    await createMenuItem(page, { name: "Masala Chai", priceInRupees: 12 });

    await page.goto("/menu");
    await expect(page.getByText("Masala Chai").first()).toBeVisible();
  });

  test("Show online switch marks an item counter only, keeping it available", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-online");
    const item = await createMenuItem(page, { name: "Kesar Lassi", priceInRupees: 40 });

    await page.goto("/menu");
    const sw = page.getByRole("switch", { name: "Show Kesar Lassi online" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Counter only", { exact: true })).toHaveCount(0);

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Counter only", { exact: true })).toBeVisible();

    const list = await page.request.get("/api/menu");
    const row = ((await list.json()) as { data: (MenuItemRow & { showOnline: boolean })[] }).data.find(
      (i) => i.id === item.id,
    );
    expect(row?.showOnline).toBe(false);
    expect(row?.isAvailable).toBe(true);
  });
});
