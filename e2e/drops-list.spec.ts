import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * The Pre-orders list (`/drops`): one table per section, icon tiles for the
 * actions (with a 12 px word under each below `lg`), and the next step filled.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const SMALL_PHONE = { width: 360, height: 780 };
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

/**
 * A store with two pre-orders: one taking orders with one order on it (so its
 * row has all five tiles) and one draft.
 */
async function seedRows(page: Page, request: APIRequestContext, label: string) {
  const suffix = Math.random().toString(36).slice(2, 7);
  const openTitle = `Saturday bakes ${suffix}`;
  const draftTitle = `Sunday thali ${suffix}`;

  await createVendorSession(page, request, label, "/menu");
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

  return { openTitle, draftTitle, openId, draftId };
}

/** The action tiles of one row (the last cell). */
function rowTiles(row: Locator): Locator {
  return row.getByRole("cell").last().locator("a, button");
}

test.describe("pre-orders list", () => {
  test("rows show icon actions per state, words on phones, a table on desktop", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { openTitle, draftTitle, openId, draftId } = await seedRows(page, request, "drops-list");

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
    await expect(openRow.getByRole("button", { name: `Duplicate pre-order: ${openTitle}` })).toBeVisible();
    await expect(openRow.getByRole("link", { name: `Print prep sheet for ${openTitle}` })).toHaveAttribute(
      "href",
      `/drops/${openId}/prep`,
    );
    await expect(openRow).toContainText("1 order");
    for (const tile of await rowTiles(openRow).all()) {
      await expectTapTarget(tile);
    }
    const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideways, "no sideways scroll at 390 px").toBe(true);

    // A draft is opened on the edit page, so its tile is plain Edit; no prep sheet or share yet.
    const draftRow = upcoming.getByRole("row").filter({ hasText: draftTitle });
    await expect(draftRow.getByRole("link", { name: `Edit ${draftTitle}` })).toHaveAttribute(
      "href",
      `/drops/${draftId}/edit`,
    );
    await expect(draftRow.getByRole("link", { name: /^Open orders for/ })).toHaveCount(0);
    await expect(draftRow.getByRole("link", { name: `Print prep sheet for ${draftTitle}` })).toHaveCount(0);
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

    // Duplicate still copies the pre-order and opens the copy.
    await page.goto("/drops");
    await page
      .getByRole("table", { name: "Upcoming" })
      .getByRole("button", { name: `Duplicate pre-order: ${draftTitle}` })
      .click();
    await expect(page).toHaveURL(/\/drops\/[^/]+\/edit$/);
    expect(page.url()).not.toContain(draftId);
  });

  test("every tile is named by its word and the pre-order, on one row at 360 px", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { openTitle, draftTitle } = await seedRows(page, request, "drops-labels");

    await page.setViewportSize(SMALL_PHONE);
    await page.goto("/drops");
    const upcoming = page.getByRole("table", { name: "Upcoming" });
    await expect(upcoming).toBeVisible();

    const expected: Array<{ title: string; tiles: Array<{ word: string; name: string }> }> = [
      {
        title: openTitle,
        tiles: [
          { word: "Orders", name: `Orders for ${openTitle}` },
          { word: "Share", name: `Share this pre-order: ${openTitle}` },
          { word: "Edit", name: `Edit ${openTitle}` },
          { word: "Duplicate", name: `Duplicate pre-order: ${openTitle}` },
          { word: "Print prep", name: `Print prep sheet for ${openTitle}` },
        ],
      },
      {
        title: draftTitle,
        tiles: [
          { word: "Orders", name: `Orders for ${draftTitle}` },
          { word: "Edit", name: `Edit ${draftTitle}` },
          { word: "Duplicate", name: `Duplicate pre-order: ${draftTitle}` },
        ],
      },
    ];

    for (const { title, tiles } of expected) {
      const row = upcoming.getByRole("row").filter({ hasText: title });
      const found = rowTiles(row);
      await expect(found, `tiles on "${title}"`).toHaveCount(tiles.length);

      const tops = new Set<number>();
      for (const [i, { word, name }] of tiles.entries()) {
        const tile = found.nth(i);
        // aria-label and tooltip are the same text, and it starts with the word on screen (label-in-name).
        await expect(tile).toHaveAccessibleName(name);
        await expect(tile).toHaveAttribute("title", name);
        await expect(tile).toHaveText(word);
        expect(name.startsWith(word), `"${name}" starts with "${word}"`).toBe(true);

        // The word is 12 px and on one line, and the tile is a 44 px target.
        const label = tile.locator("span[aria-hidden]");
        const { fontSize, lines } = await label.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            fontSize: style.fontSize,
            lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight || style.fontSize)),
          };
        });
        expect(fontSize, `"${word}" font size`).toBe("12px");
        expect(lines, `"${word}" stays on one line`).toBe(1);
        await expectTapTarget(tile);
        tops.add(Math.round((await tile.boundingBox())!.y));
      }
      expect(tops.size, `"${title}" tiles share one row`).toBe(1);
    }

    const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideways, "no sideways scroll at 360 px").toBe(true);
  });
});
