import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Pre-order links, /s/<slug>/preorder/<dropId> (docs/DROP_LINK_PLAN.md): the
 * store page showing one drop only, with a link preview of that drop's items.
 * A drop the page wouldn't list (a draft, another store's) shows the whole
 * store with a notice, never a 404 and never the other store's items.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const json = { "Content-Type": "application/json" };

/** Two days out (IST), so the cut-off is always in the future. */
function dropDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  );
}

async function createDrop(
  page: Page,
  title: string,
  menuItemId: string,
  { open = true }: { open?: boolean } = {},
): Promise<string> {
  const ymd = dropDay();
  const created = await page.request.post("/api/drops", {
    data: {
      title,
      date: ymd,
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "19:00",
      closesAtDate: ymd,
      closesAtTime: "12:00",
      showEverydayMenu: true,
      items: [{ menuItemId, priceInPaise: 15000 }],
    },
    headers: json,
  });
  expect(created.status(), `create drop "${title}"`).toBe(201);
  const { data } = (await created.json()) as { data: { id: string } };
  if (open) {
    const opened = await page.request.patch(`/api/drops/${data.id}/status`, { data: { status: "OPEN" }, headers: json });
    expect(opened.status(), `open drop "${title}"`).toBe(200);
  }
  return data.id;
}

async function publishStore(page: Page): Promise<string> {
  const res = await page.request.patch("/api/vendor", {
    data: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true },
    headers: json,
  });
  expect(res.ok(), "publish the store").toBe(true);
  const me = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
  return me.vendor.slug;
}

test.describe("storefront: pre-order links", () => {
  test("a drop's link shows that drop only, with its own preview", async ({ page, request, browser }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const names = {
      laddu: `Ragi Laddu ${suffix}`,
      hamper: `Diwali Hamper ${suffix}`,
      poha: `Everyday Poha ${suffix}`,
      draftCake: `Draft Cake ${suffix}`,
      otherStore: `Other Store Thepla ${suffix}`,
    };
    const titles = { a: `Saturday Bakes ${suffix}`, b: `Festive Boxes ${suffix}`, draft: `Next Week ${suffix}` };

    await createVendorSession(page, request, "preorderlink", "/menu");
    const slug = await publishStore(page);
    const laddu = await createMenuItem(page, { name: names.laddu, priceInRupees: 150 });
    const hamper = await createMenuItem(page, { name: names.hamper, priceInRupees: 900 });
    await createMenuItem(page, { name: names.poha, priceInRupees: 40 });
    const draftCake = await createMenuItem(page, { name: names.draftCake, priceInRupees: 500 });
    const dropA = await createDrop(page, titles.a, laddu.id);
    await createDrop(page, titles.b, hamper.id);
    const draft = await createDrop(page, titles.draft, draftCake.id, { open: false });

    // A second store with its own open drop: its id must never show under the first store's slug.
    const otherCtx = await browser.newContext(CONTEXT_OPTIONS);
    let otherDrop: string;
    try {
      const other = await otherCtx.newPage();
      await createVendorSession(other, other.request, "preorderother", "/menu");
      await publishStore(other);
      const thepla = await createMenuItem(other, { name: names.otherStore, priceInRupees: 60 });
      otherDrop = await createDrop(other, `Other store drop ${suffix}`, thepla.id);
    } finally {
      await otherCtx.close();
    }

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();

      // Drop A's link: A alone, no other drop, no everyday menu, a way back to the store.
      const res = await buyer.goto(`/s/${slug}/preorder/${dropA}`);
      expect(res?.status()).toBe(200);
      const main = buyer.locator("main#menu");
      await expect(main.getByText(names.laddu).first()).toBeVisible();
      await expect(main.getByRole("heading", { name: titles.a })).toBeVisible();
      await expect(main.getByText(titles.b)).toHaveCount(0);
      await expect(main.getByText(names.hamper)).toHaveCount(0);
      await expect(main.getByText(names.poha)).toHaveCount(0);
      await expect(main.getByRole("link", { name: /See everything from/ })).toHaveAttribute("href", `/s/${slug}`);

      // Its preview is the drop's own card, versioned, and the image is a PNG.
      await expect(buyer.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(titles.a));
      const ogImage = await buyer.locator('meta[property="og:image"]').first().getAttribute("content");
      expect(ogImage).toContain(`/s/${slug}/preorder/${dropA}/share-card?v=`);
      const card = await buyer.request.get(ogImage!);
      expect(card.status()).toBe(200);
      expect(card.headers()["content-type"]).toContain("image/png");
      await expect(buyer.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      // A draft's link: the whole store (both open pre-orders and the everyday menu) with a
      // notice, and never the draft itself. Its item is on the everyday menu like any other.
      await buyer.goto(`/s/${slug}/preorder/${draft}`);
      await expect(main.getByText("This pre-order isn't taking orders.", { exact: false })).toBeVisible();
      await expect(main.getByRole("heading", { name: titles.a })).toBeVisible();
      await expect(main.getByRole("heading", { name: titles.b })).toBeVisible();
      await expect(main.getByText(names.poha).first()).toBeVisible();
      await expect(main.getByText(titles.draft)).toHaveCount(0);

      // Another store's drop id under this slug: this store with the notice, none of the other store's items.
      await buyer.goto(`/s/${slug}/preorder/${otherDrop!}`);
      await expect(main.getByText("This pre-order isn't taking orders.", { exact: false })).toBeVisible();
      await expect(buyer.getByText(names.otherStore)).toHaveCount(0);
      const otherCard = await buyer.request.get(`/s/${slug}/preorder/${otherDrop!}/share-card`);
      expect(otherCard.status()).toBe(200);
      expect(otherCard.headers()["content-type"]).toContain("image/png");

      // An unknown store 404s like /s/<slug>.
      const missing = await buyer.request.get(`/s/zz-no-such-store-${suffix}/preorder/${dropA}`);
      expect(missing.status()).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});
