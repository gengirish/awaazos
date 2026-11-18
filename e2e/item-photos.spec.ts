import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, seedItemPhotos } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * Several photos per item (lib/item-photos.ts, docs/PRODUCT_PAGE_PLAN.md step 3):
 * the seller reorders them in the item form (the first is the cover), and the
 * buyer swipes through them in the item's detail sheet.
 *
 * e2e runs have no Vercel Blob, so the photos are seeded in the local database
 * (files under /public); the reorder goes through the real route.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

test.describe("item photos", () => {
  test.skip(!CAN_SET_BILLING, "seeds photos in the local database");

  test("a seller makes another photo the cover and a buyer swipes through all of them", async ({ page, request, browser }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const name = `Thali ${suffix}`;

    await createVendorSession(page, request, "photos", "/menu");
    const item = await createMenuItem(page, { name, priceInRupees: 180, category: "Meals" });
    await seedItemPhotos(item.id, ["/food/biryani.webp", "/food/bread.webp", "/food/barfi.webp"]);

    // The API lists them cover first; an order that misses one is refused with the real list.
    const listed = await page.request.get(`/api/menu/${item.id}/images`);
    expect(listed.status()).toBe(200);
    const photos = ((await listed.json()) as { data: { id: string; url: string }[] }).data;
    expect(photos.map((p) => p.url)).toEqual(["/food/biryani.webp", "/food/bread.webp", "/food/barfi.webp"]);
    expect(photos[0]!.id).toBe("cover");
    const stale = await page.request.put(`/api/menu/${item.id}/images/order`, { data: { order: ["cover", photos[1]!.id] } });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe("photos_changed");

    // In the item form, the second photo becomes the cover.
    await page.goto("/menu");
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const form = page.getByRole("dialog");
    const strip = form.getByRole("list", { name: `Photos of ${name}, cover first` });
    await expect(strip.getByTestId("item-photo")).toHaveCount(3);
    await form.getByRole("button", { name: "Make photo 2 the cover" }).click();
    await expect(page.getByText("Cover photo changed")).toBeVisible();
    await expect(strip.getByRole("img", { name: `Photo 1 of ${name}` })).toHaveAttribute("src", /bread/);

    const after = ((await (await page.request.get(`/api/menu/${item.id}/images`)).json()) as { data: { url: string }[] }).data;
    expect(after.map((p) => p.url)).toEqual(["/food/bread.webp", "/food/biryani.webp", "/food/barfi.webp"]);
    const menu = ((await (await page.request.get("/api/menu")).json()) as { data: { id: string; imageUrl: string | null }[] }).data;
    expect(menu.find((m) => m.id === item.id)?.imageUrl, "the cover is the item's imageUrl").toBe("/food/bread.webp");

    const { slug } = await openStoreForMenuOrders(page);
    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      await buyer.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const sheet = buyer.getByRole("dialog", { name });
      const gallery = sheet.getByRole("region", { name: `Photos of ${name}` });
      await expect(gallery.getByRole("group", { name: /^Photo \d of 3$/ })).toHaveCount(3);
      await expect(gallery.getByText("1 / 3")).toBeVisible();
      await expect(gallery.getByRole("button", { name: "Previous photo" })).toBeDisabled();
      const next = gallery.getByRole("button", { name: "Next photo" });
      await next.click();
      await expect(gallery.getByText("2 / 3")).toBeVisible();
      await gallery.getByRole("button", { name: "Previous photo" }).click();
      await expect(gallery.getByText("1 / 3")).toBeVisible();
      // Two quick taps while the first scroll is still moving land on the third photo.
      await next.click();
      await next.click();
      await expect(gallery.getByText("3 / 3")).toBeVisible();
      await expect(next).toBeDisabled();
      // Each photo still opens full size.
      await gallery.getByRole("button", { name: `See photo 3 of 3 of ${name}` }).click();
      await expect(buyer.getByRole("img", { name })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
