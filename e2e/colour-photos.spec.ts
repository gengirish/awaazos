import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, seedItemPhotos } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * A photo per colour (lib/item-variants.ts rule 8): a size / colour points at one
 * of its item's photos, and a buyer who picks it sees that photo on the row and
 * in the detail sheet's gallery.
 *
 * e2e runs have no Vercel Blob, so the photos are seeded in the local database
 * (files under /public); the variants and the reorder go through the real routes.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

type VariantRow = { id: string; label: string; imageUrl: string | null };

test.describe("colour photos", () => {
  test.skip(!CAN_SET_BILLING, "seeds photos in the local database");

  test("a colour shows its own photo, keeps it through a reorder, and never takes a foreign URL", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const name = `Silk Saree ${suffix}`;

    await createVendorSession(page, request, "colour-photos", "/menu");
    const item = await createMenuItem(page, { name, priceInRupees: 2499, category: "Sarees" });
    await seedItemPhotos(item.id, ["/food/biryani.webp", "/food/bread.webp", "/food/barfi.webp"]);

    const put = await page.request.put(`/api/menu/${item.id}/variants`, {
      data: {
        variants: [
          { label: "Red", imageUrl: "/food/biryani.webp" },
          { label: "Green", imageUrl: "/food/bread.webp" },
          // Not one of the item's photos: stored as none.
          { label: "Blue", imageUrl: "https://example.com/elsewhere.jpg" },
        ],
      },
      headers: JSON_HEADERS,
    });
    expect(put.status(), await put.text()).toBe(200);
    const saved = ((await put.json()) as { data: VariantRow[] }).data;
    expect(saved.map((v) => [v.label, v.imageUrl])).toEqual([
      ["Red", "/food/biryani.webp"],
      ["Green", "/food/bread.webp"],
      ["Blue", null],
    ]);

    // Moving the Green photo to the cover keeps the link: it is by URL.
    const photos = ((await (await page.request.get(`/api/menu/${item.id}/images`)).json()) as { data: { id: string; url: string }[] })
      .data;
    const order = [photos[1]!.id, photos[0]!.id, photos[2]!.id];
    const moved = await page.request.put(`/api/menu/${item.id}/images/order`, { data: { order }, headers: JSON_HEADERS });
    expect(moved.status(), await moved.text()).toBe(200);
    const menu = ((await (await page.request.get("/api/menu")).json()) as { data: { id: string; variants: VariantRow[] }[] }).data;
    expect(menu.find((m) => m.id === item.id)?.variants.map((v) => v.imageUrl)).toEqual([
      "/food/biryani.webp",
      "/food/bread.webp",
      null,
    ]);

    // In the item form, the seller gives Blue the third photo by tapping it.
    await page.goto("/menu");
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const form = page.getByRole("dialog");
    const bluePhoto = form.getByRole("group", { name: "Photo buyers see for Blue" });
    await expect(bluePhoto.getByRole("radio", { name: "None" })).toBeChecked();
    await expect(form.getByRole("group", { name: "Photo buyers see for Green" }).getByRole("radio", { name: "Photo 1, the cover" })).toBeChecked();
    // The radio is visually hidden inside its picture: tap the picture, as a seller would.
    await bluePhoto.locator("label").filter({ has: page.getByRole("radio", { name: "Photo 3" }) }).click();
    await expect(bluePhoto.getByRole("radio", { name: "Photo 3" })).toBeChecked();
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toBeHidden();
    const afterForm = ((await (await page.request.get("/api/menu")).json()) as { data: { id: string; variants: VariantRow[] }[] })
      .data;
    expect(afterForm.find((m) => m.id === item.id)?.variants.map((v) => v.imageUrl)).toEqual([
      "/food/biryani.webp",
      "/food/bread.webp",
      "/food/barfi.webp",
    ]);

    const { slug } = await openStoreForMenuOrders(page);
    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      const row = buyer.locator(`[id="menu-item-${item.id}"]`);
      const rowPhoto = row.locator("img").first();
      // Before a pick, the row shows the cover (now the Green photo).
      await expect(rowPhoto).toHaveAttribute("src", /bread/);

      const options = row.getByRole("group", { name: `${name}: size or colour` });
      await options.getByText("Red", { exact: true }).click();
      await expect(options.getByRole("radio", { name: "Red" })).toBeChecked();
      await expect(rowPhoto).toHaveAttribute("src", /biryani/);

      // The detail sheet opens on the picked colour's photo: second after the reorder.
      await row.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const sheet = buyer.getByRole("dialog", { name });
      const gallery = sheet.getByRole("region", { name: `Photos of ${name}` });
      await expect(gallery.getByText("2 / 3")).toBeVisible();
      // Picking Green in the sheet turns the gallery to the cover.
      await sheet.getByRole("group", { name: `${name}: size or colour` }).getByText("Green", { exact: true }).click();
      await expect(gallery.getByText("1 / 3")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
