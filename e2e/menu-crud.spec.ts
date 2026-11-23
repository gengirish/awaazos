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

    // DELETE archives (lib/menu-archive.ts): the row stays so historical bills that
    // reference it keep resolving, but it leaves every catalogue list.
    const del = await page.request.delete(`/api/menu/${created.id}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    const after = await page.request.get("/api/menu");
    const afterBody = (await after.json()) as { data: MenuItemRow[] };
    expect(afterBody.data.some((i) => i.id === created.id), "a deleted item leaves the list").toBe(false);

    // Gone for good: no second delete, no edit back onto the menu.
    expect((await page.request.delete(`/api/menu/${created.id}`)).status()).toBe(404);
    expect((await page.request.patch(`/api/menu/${created.id}`, { data: { isAvailable: true } })).status()).toBe(404);

    // The name is free again (slug gets the usual suffix).
    const again = await createMenuItem(page, { name: "Bhel Puri", priceInRupees: 25, category: "Chaat" });
    expect(again.id).not.toBe(created.id);
  });

  test("delete is refused while an open pre-order sells the item", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-del-drop");
    const item = await createMenuItem(page, { name: "Drop Samosa", priceInRupees: 20 });
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    );
    const created = await page.request.post("/api/drops", {
      data: {
        title: "Saturday Samosas",
        date: ymd,
        fulfilmentMode: "PICKUP",
        fulfilmentStart: "17:00",
        fulfilmentEnd: "19:00",
        closesAtDate: ymd,
        closesAtTime: "12:00",
        items: [{ menuItemId: item.id, priceInPaise: 2000 }],
      },
    });
    expect(created.status()).toBe(201);
    const { data: drop } = (await created.json()) as { data: { id: string } };

    // A draft can still open, so it blocks too.
    const refused = await page.request.delete(`/api/menu/${item.id}`);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: "in_open_drop", drops: [{ id: drop.id, title: "Saturday Samosas" }] });
    const list = (await (await page.request.get("/api/menu")).json()) as { data: MenuItemRow[] };
    expect(list.data.some((i) => i.id === item.id)).toBe(true);

    // Once the drop is gone, the delete goes through.
    expect((await page.request.delete(`/api/drops/${drop.id}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/menu/${item.id}`)).status()).toBe(200);
  });

  test("rename a category on every item that has it", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-cat");
    const a = await createMenuItem(page, { name: "Pani Puri", priceInRupees: 30, category: "Chat" });
    const b = await createMenuItem(page, { name: "Sev Puri", priceInRupees: 35, category: "Chat" });
    const c = await createMenuItem(page, { name: "Lassi", priceInRupees: 40, category: "Drinks" });

    const empty = await page.request.patch("/api/menu/categories", { data: { from: "Chat", to: "   " } });
    expect(empty.status()).toBe(400);

    const renamed = await page.request.patch("/api/menu/categories", { data: { from: "Chat", to: "  Chaat " } });
    expect(renamed.status()).toBe(200);
    expect(await renamed.json()).toEqual({ data: { updated: 2 } });

    const list = (await (await page.request.get("/api/menu")).json()) as { data: (MenuItemRow & { category: string })[] };
    const byId = new Map(list.data.map((i) => [i.id, i.category]));
    expect(byId.get(a.id)).toBe("Chaat");
    expect(byId.get(b.id)).toBe("Chaat");
    expect(byId.get(c.id)).toBe("Drinks");
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

  // The item form loads on first open (components/menu/MenuScreen.tsx), so check
  // the paths that mount it: the ?add= link, Edit, and reopening after a close.
  test("item form opens pre-filled from ?add= and from Edit, and reopens", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-form");
    await createMenuItem(page, { name: "Masala Chai", priceInRupees: 12 });

    await page.goto("/menu?add=Ragi%20Laddu");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /^Add / })).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue("Ragi Laddu");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Masala Chai" }).click();
    await expect(dialog.getByRole("heading", { name: "Edit item" })).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue("Masala Chai");
    await expect(dialog.getByLabel("Price (₹)")).toHaveValue("12");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Add item" }).click();
    await expect(dialog.getByLabel("Name")).toHaveValue("");
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

  test("a long description never pushes the cards off a 360 px phone", async ({ page, request }) => {
    // An implicit grid column grows to the longest unbroken description line, so the
    // page scrolled sideways and dialogs opened off-centre (fixed with grid-cols-1).
    await page.setViewportSize({ width: 360, height: 740 });
    await createVendorSession(page, request, "menu-narrow", "/menu");
    await createMenuItem(page, {
      name: "Oxidised Silver Jhumkas",
      priceInRupees: 450,
      description: "Light enough to wear all day. Silver-tone with a stone, and a matching pouch.",
    });
    await page.goto("/menu");
    await expect(page.getByText("Oxidised Silver Jhumkas")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the menu page should not scroll sideways").toBeLessThanOrEqual(0);
  });
});

test.describe("menu screen: delete and rename", () => {
  test("delete a dish from its form, rename a category from its chip", async ({ page, request }) => {
    await createVendorSession(page, request, "menu-ui-del");
    await createMenuItem(page, { name: "Test Junk Item", priceInRupees: 10, category: "Snaks" });
    await createMenuItem(page, { name: "Keeper Vada", priceInRupees: 20, category: "Snaks" });

    await page.goto("/menu");
    await page.getByRole("button", { name: "Edit Test Junk Item" }).click();
    const form = page.getByRole("dialog", { name: "Edit item" });
    await form.getByRole("button", { name: "Delete dish" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete Test Junk Item?" });
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Test Junk Item deleted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Test Junk Item" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit Keeper Vada" })).toBeVisible();

    await page.getByRole("button", { name: "Rename category Snaks" }).click();
    const sheet = page.getByRole("dialog", { name: "Rename category" });
    await sheet.getByLabel("New name").fill("Snacks");
    await sheet.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByText("Renamed to “Snacks” (1 item)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename category Snacks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename category Snaks" })).toHaveCount(0);
  });
});
