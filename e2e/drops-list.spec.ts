import { expect, test, type Locator, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * The Pre-orders list (`/drops`): one table per section, icon tiles for the
 * actions (with a tiny word under each below `lg`), and the next step filled.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function istYmd(days: number): string {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return istNow.toISOString().slice(0, 10);
}

async function createDrop(page: Page, title: string, menuItem: { id: string; priceInPaise: number }): Promise<string> {
  const res = await page.request.post("/api/drops", {
    data: {
      title,
      date: istYmd(2),
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "19:00",
      closesAtDate: istYmd(1),
      closesAtTime: "21:00",
      items: [{ menuItemId: menuItem.id, priceInPaise: menuItem.priceInPaise, maxQty: 20 }],
    },
    headers: JSON_HEADERS,
  });
  expect(res.status(), `POST /api/drops (${title})`).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function expectTapTarget(tile: Locator) {
  const box = await tile.boundingBox();
  expect(box, "tile is rendered").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test.describe("pre-orders list", () => {
  test("rows show icon actions per state, words on phones, a table on desktop", async ({ page, request }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const openTitle = `Saturday bakes ${suffix}`;
    const draftTitle = `Sunday thali ${suffix}`;

    await createVendorSession(page, request, "drops-list", "/menu");
    const store = await openStoreForMenuOrders(page);
    const item = await createMenuItem(page, { name: `Banana bread ${suffix}`, priceInRupees: 250 });

    const openId = await createDrop(page, openTitle, item);
    const opened = await page.request.patch(`/api/drops/${openId}/status`, {
      data: { status: "OPEN" },
      headers: JSON_HEADERS,
    });
    expect(opened.status(), "open the drop").toBe(200);
    const draftId = await createDrop(page, draftTitle, item);

    // One order on the open drop, so its row offers the prep sheet.
    const detail = await page.request.get(`/api/drops/${openId}`);
    const dropItems = ((await detail.json()) as { data: { items: { id: string }[] } }).data.items;
    const order = await page.request.post(`/api/s/${store.slug}/orders`, {
      data: {
        customerName: "Priya Buyer",
        customerPhone: "98480 12345",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
        dropId: openId,
        items: [{ dropItemId: dropItems[0].id, qty: 2 }],
      },
      headers: JSON_HEADERS,
    });
    expect(order.status(), "storefront drop order").toBe(201);

    // ── Phone: stacked rows, each tile with its word ─────────────────────
    await page.setViewportSize(PHONE);
    await page.goto("/drops");
    const upcoming = page.getByRole("table", { name: "Upcoming" });
    await expect(upcoming).toBeVisible();

    const openRow = upcoming.getByRole("row").filter({ hasText: openTitle });
    const share = openRow.getByRole("button", { name: `Share this pre-order: ${openTitle}` });
    await expect(share).toBeVisible();
    await expect(share).toContainText("Share");
    await expect(openRow.getByRole("link", { name: `Orders for ${openTitle}` })).toBeVisible();
    await expect(openRow.getByRole("link", { name: `Edit ${openTitle}` })).toBeVisible();
    await expect(openRow.getByRole("button", { name: `Copy ${openTitle} for tomorrow` })).toBeVisible();
    await expect(openRow.getByRole("link", { name: `Prep sheet for ${openTitle}` })).toHaveAttribute(
      "href",
      `/drops/${openId}/prep`,
    );
    await expect(openRow).toContainText("1 order");
    for (const tile of await openRow.getByRole("cell").last().locator("a, button").all()) {
      await expectTapTarget(tile);
    }
    const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideways, "no sideways scroll at 390 px").toBe(true);

    // A draft's next step is opening orders (the edit page); no Edit tile beside it, no prep sheet yet.
    const draftRow = upcoming.getByRole("row").filter({ hasText: draftTitle });
    await expect(draftRow.getByRole("link", { name: `Open orders for ${draftTitle}` })).toHaveAttribute(
      "href",
      `/drops/${draftId}/edit`,
    );
    await expect(draftRow.getByRole("link", { name: `Edit ${draftTitle}` })).toHaveCount(0);
    await expect(draftRow.getByRole("link", { name: `Prep sheet for ${draftTitle}` })).toHaveCount(0);
    await expect(draftRow.getByRole("button", { name: /^Share this pre-order/ })).toHaveCount(0);

    // ── Desktop: real columns, icons without words ───────────────────────
    await page.setViewportSize(DESKTOP);
    await expect(upcoming.getByRole("columnheader", { name: "Pre-order" })).toBeVisible();
    await expect(upcoming.getByRole("columnheader", { name: "Orders" })).toBeVisible();
    await expect(share.getByText("Share", { exact: true })).toBeHidden();
    await expect(share).toHaveAttribute("title", `Share this pre-order: ${openTitle}`);

    // Orders tile goes to the one orders board, on this pre-order.
    await openRow.getByRole("link", { name: `Orders for ${openTitle}` }).click();
    await expect(page).toHaveURL(new RegExp(`/orders\\?drop=${openId}`));

    // Copy for tomorrow still duplicates and opens the copy.
    await page.goto("/drops");
    await page
      .getByRole("table", { name: "Upcoming" })
      .getByRole("button", { name: `Copy ${draftTitle} for tomorrow` })
      .click();
    await expect(page).toHaveURL(/\/drops\/[^/]+\/edit$/);
    expect(page.url()).not.toContain(draftId);
  });
});
