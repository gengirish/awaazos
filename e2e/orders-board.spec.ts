import { expect, test } from "@playwright/test";

import { boardHeaderAction, closeBoardActions } from "./helpers/board";
import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * One orders board. A kitchen that takes orders from its everyday menu AND runs
 * a drop sees both kinds on `/orders`:
 *   - each card says where it came from while the list mixes sources;
 *   - the "Show orders from" picker narrows the board to menu orders or one drop
 *     (and then offers that drop's Prep sheet / Edit);
 *   - a bulk action over a mixed selection reaches both route families;
 *   - the old per-drop address (`/drops/[id]`) lands on the same board.
 */
test.describe("Orders board: menu and drop orders together", () => {
  test.describe.configure({ timeout: 300_000 });

  test("mixed list, picker, bulk confirm across sources, old drop link", async ({ page, request }) => {
    await createVendorSession(page, request, "one-board");
    const json = { "Content-Type": "application/json" };

    const settings = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true },
      headers: json,
    });
    expect(settings.status()).toBe(200);
    const { vendor } = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };

    const poha = await createMenuItem(page, { name: "Board Poha", priceInRupees: 40 });
    const laddu = await createMenuItem(page, { name: "Board Laddu", priceInRupees: 150 });

    // A drop two days out (IST) that keeps the everyday menu orderable alongside it.
    const dropTitle = "Board Saturday Bakes";
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    );
    const created = await page.request.post("/api/drops", {
      data: {
        title: dropTitle,
        date: ymd,
        fulfilmentMode: "PICKUP",
        fulfilmentStart: "17:00",
        fulfilmentEnd: "19:00",
        closesAtDate: ymd,
        closesAtTime: "12:00",
        showEverydayMenu: true,
        items: [{ menuItemId: laddu.id, priceInPaise: 15000 }],
      },
      headers: json,
    });
    expect(created.status()).toBe(201);
    const { data: drop } = (await created.json()) as { data: { id: string } };
    const opened = await page.request.patch(`/api/drops/${drop.id}/status`, { data: { status: "OPEN" }, headers: json });
    expect(opened.status()).toBe(200);
    const detail = (await (await page.request.get(`/api/drops/${drop.id}`)).json()) as {
      data: { items: { id: string }[] };
    };
    const dropItemId = detail.data.items[0]!.id;

    // Two guest buyers (no session): one from the menu, one from the drop.
    const menuOrder = await request.post(`/api/s/${vendor.slug}/menu-orders`, {
      data: {
        items: [{ menuItemId: poha.id, qty: 2 }],
        customerName: "Menu Meera",
        customerPhone: "+919848054321",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
      },
      headers: json,
    });
    expect(menuOrder.status()).toBe(201);
    const dropOrder = await request.post(`/api/s/${vendor.slug}/orders`, {
      data: {
        dropId: drop.id,
        items: [{ dropItemId, qty: 1 }],
        customerName: "Drop Divya",
        customerPhone: "+919848054322",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
      },
      headers: json,
    });
    expect(dropOrder.status()).toBe(201);

    // ── One page, both orders, each labelled with its source ─────────────
    await page.goto("/orders");
    await expect(page.getByRole("heading", { level: 1, name: "Orders", exact: true })).toBeVisible();
    const menuCard = page.getByRole("article", { name: /Menu Meera/ });
    const dropCard = page.getByRole("article", { name: /Drop Divya/ });
    await expect(menuCard).toBeVisible();
    await expect(dropCard).toBeVisible();
    await expect(menuCard.getByText("Menu order", { exact: true })).toBeVisible();
    await expect(dropCard.getByText(dropTitle, { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Needs action (2)" })).toBeVisible();

    // ── One bulk confirm over both: each order goes to its own route ─────
    // "Last checked" is set on mount, so it marks the board as hydrated; a tap
    // on the server-rendered checkbox before that is lost.
    await expect(page.getByText(/^Last checked/)).toBeVisible();
    await page.getByRole("checkbox", { name: /select all/i }).check();
    await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Confirm 2 orders" }).click();
    await expect(page.getByRole("tab", { name: "Confirmed (2)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Needs action (0)" })).toBeVisible();
    await page.getByRole("tab", { name: /^Confirmed/ }).click();
    await expect(menuCard).toBeVisible();
    await expect(dropCard).toBeVisible();

    // ── Narrow to the drop: only its order, plus its own tools ───────────
    const picker = page.getByRole("combobox", { name: "Show orders from" });
    expect((await picker.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    await picker.click();
    await page.getByRole("option", { name: new RegExp(dropTitle) }).click();
    await expect(page).toHaveURL(new RegExp(`/orders\\?drop=${drop.id}$`));
    await expect(dropCard).toBeVisible();
    await expect(menuCard).toHaveCount(0);
    await expect(page.locator("p", { hasText: "To cook:" })).toContainText("Board Laddu 1");
    await expect(await boardHeaderAction(page, "link", "Prep sheet")).toHaveAttribute("href", `/drops/${drop.id}/prep`);
    await expect(await boardHeaderAction(page, "link", "Edit")).toHaveAttribute("href", `/drops/${drop.id}/edit`);
    await closeBoardActions(page);

    // ── Narrow to menu orders ────────────────────────────────────────────
    await picker.click();
    await page.getByRole("option", { name: "Menu orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(menuCard).toBeVisible();
    await expect(dropCard).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "To make", exact: true })).toBeVisible();

    // ── The old per-drop address opens the same board on that drop ───────
    await page.goto(`/drops/${drop.id}`);
    await expect(page).toHaveURL(new RegExp(`/orders\\?drop=${drop.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Orders", exact: true })).toBeVisible();
    // Only the drop's one order is counted: the menu order is out of this view.
    await expect(page.getByRole("tab", { name: "Confirmed (1)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All (1)" })).toBeVisible();
    await expect(page.locator("p", { hasText: "To cook:" })).toContainText("Board Laddu 1");
  });
});
