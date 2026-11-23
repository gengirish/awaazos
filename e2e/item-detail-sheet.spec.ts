import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * The item detail sheet on /s/[slug] (components/storefront/ItemDetailSheet.tsx):
 * a tap on an item's name opens its photo, discount-first price, whole
 * description, the offers it counts toward, how it is handed over and paid for,
 * and Add, which is the same cart as the row's stepper. A read-only menu opens
 * the same sheet without Add.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

test.describe("storefront: item detail sheet", () => {
  test("a buyer opens an item, sees its details and adds it from the sheet", async ({ page, request, browser }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const dosa = `Masala Dosa ${suffix}`;
    const description = "Crisp dosa with spiced potato filling, coconut chutney and sambar";

    await createVendorSession(page, request, "itemsheet", "/menu");
    await createMenuItem(page, { name: dosa, priceInRupees: 80, category: "Meals", description });
    const sale = await page.request.post("/api/offers", {
      data: { name: "Festive sale", eligibility: "ALL", minQty: 1, percentBps: 2500 },
    });
    expect(sale.status(), "create a 25% sale").toBe(201);

    // Before menu orders are on, the menu is read-only: the sheet opens without Add.
    const pub = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(pub.ok()).toBe(true);
    const me = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
    const slug = me.vendor.slug;

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      await buyer.getByRole("button", { name: new RegExp(`^${dosa}`) }).click();
      const readOnly = buyer.getByRole("dialog", { name: dosa });
      await expect(readOnly).toBeVisible();
      await expect(readOnly.getByText(description)).toBeVisible();
      await expect(readOnly.getByRole("button", { name: `Add ${dosa}` })).toHaveCount(0);
      await buyer.keyboard.press("Escape");
      await expect(readOnly).toBeHidden();
    } finally {
      await ctx.close();
    }

    await openStoreForMenuOrders(page);

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}`);

      const trigger = buyer.getByRole("button", { name: new RegExp(`^${dosa}`) });
      await trigger.click();
      const sheet = buyer.getByRole("dialog", { name: dosa });
      await expect(sheet).toBeVisible();

      // Price discount first: 25% off ₹80 is ₹60, said in one sentence to a screen reader.
      await expect(sheet.getByText("₹60, 25% off, was ₹80 (Festive sale)")).toBeAttached();
      await expect(sheet.getByText(description)).toBeVisible();
      await expect(sheet.getByRole("list", { name: "Offers" })).toContainText("Festive sale");
      const facts = sheet.getByRole("list", { name: "How you get it" });
      await expect(facts).toContainText("Pickup");
      await expect(facts).toContainText("Pay on delivery");

      // Add in the sheet is the row's stepper: the cart bar shows it after closing.
      await sheet.getByRole("button", { name: `Add ${dosa}` }).click();
      await sheet.getByRole("button", { name: `Add one more ${dosa}` }).click();
      await expect(sheet.getByRole("group", { name: `${dosa} quantity` })).toContainText("2");
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(buyer.getByRole("group", { name: `${dosa} quantity` })).toContainText("2");
      await expect(buyer.getByRole("button", { name: /checkout/i }).first()).toBeVisible();
    } finally {
      await buyerCtx.close();
    }
  });

  test("a product link opens the item, keeps the Instagram tag and follows Back", async ({ page, request, browser }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const kurti = `Cotton Kurti ${suffix}`;
    const hidden = `Counter Tea ${suffix}`;

    await createVendorSession(page, request, "itemlink", "/menu");
    const item = await createMenuItem(page, { name: kurti, priceInRupees: 650, category: "Kurtis" });
    const counterOnly = await createMenuItem(page, { name: hidden, priceInRupees: 10, category: "Drinks" });
    const off = await page.request.patch(`/api/menu/${counterOnly.id}`, {
      data: { showOnline: false },
      headers: { "Content-Type": "application/json" },
    });
    expect(off.ok()).toBe(true);
    const { slug } = await openStoreForMenuOrders(page);

    // The seller's menu card offers the link once the store is published.
    await page.goto("/menu");
    await expect(page.getByRole("button", { name: `Copy link to ${kurti} for Instagram` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Copy link to ${hidden} for Instagram` })).toHaveCount(0);

    // Link previews: the item's own title and card.
    const html = await (await request.get(`/s/${slug}/p/${item.id}`)).text();
    expect(html).toContain(`<title>${kurti} · `);
    // The card URL carries a content version, so a changed item is a new URL for crawlers.
    const ogUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    expect(ogUrl).toContain(`/s/${slug}/p/${item.id}/share-card?v=`);
    const og = await request.get(new URL(ogUrl!).pathname + new URL(ogUrl!).search);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    expect(og.headers()["cache-control"]).not.toContain("immutable");

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      const res = await buyer.goto(`/s/${slug}/p/${item.id}?src=ig`);
      expect(res?.status()).toBe(200);
      const sheet = buyer.getByRole("dialog", { name: kurti });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Share" })).toBeVisible();

      // Closing goes to the store's address with the tag kept for checkout.
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();
      await expect(buyer).toHaveURL(new RegExp(`/s/${slug}[?]src=ig$`));

      // A tap pushes the product address; the phone's Back closes the sheet.
      await buyer.getByRole("button", { name: new RegExp(`^${kurti}`) }).click();
      await expect(sheet).toBeVisible();
      await expect(buyer).toHaveURL(new RegExp(`/s/${slug}/p/${item.id}[?]src=ig$`));
      await buyer.goBack();
      await expect(sheet).toBeHidden();
      await expect(buyer).toHaveURL(new RegExp(`/s/${slug}[?]src=ig$`));

      // A counter-only item and a made-up id: the store with a notice, never a 404.
      for (const id of [counterOnly.id, "not-a-real-item"]) {
        const r = await buyer.goto(`/s/${slug}/p/${id}`);
        expect(r?.status()).toBe(200);
        await expect(buyer.getByRole("status").filter({ hasText: "isn't on sale right now" })).toBeVisible();
        await expect(buyer.getByRole("dialog")).toHaveCount(0);
      }
      await expect(buyer.getByText(hidden)).toHaveCount(0);
    } finally {
      await ctx.close();
    }

    // An unpublished store's product link is a 404, like the store itself.
    const unpub = await page.request.patch("/api/vendor", {
      data: { publishStorefront: false },
      headers: { "Content-Type": "application/json" },
    });
    expect(unpub.ok()).toBe(true);
    expect((await request.get(`/s/${slug}/p/${item.id}`)).status()).toBe(404);
  });
});
