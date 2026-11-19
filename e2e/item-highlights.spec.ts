import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * Highlights, details and the veg mark (lib/item-highlights.ts,
 * docs/PRODUCT_PAGE_PLAN.md step 4): the seller adds them in the item form, and
 * the buyer sees the mark on the row and the rest in the item's detail sheet.
 * The cost price never reaches the store page.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

test.describe("item highlights and veg mark", () => {
  test("a kitchen adds highlights and a veg mark; a buyer sees them", async ({ page, request, browser }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 7);
    const name = `Paneer Tikka ${suffix}`;
    const details = "Marinated overnight in hung curd.\nGrilled to order in the tandoor.";

    await createVendorSession(page, request, "highlights", "/menu");
    const created = await page.request.post("/api/menu", {
      data: {
        name,
        priceInRupees: 240,
        category: "Starters",
        details,
        highlights: [{ label: "Serves", value: "2 people" }],
        foodType: "VEG",
        costInRupees: 987.65,
      },
    });
    expect(created.status()).toBe(201);
    const item = ((await created.json()) as { data: { id: string } }).data;

    // Refused, never cut: a half-filled row and an unknown mark are 400s.
    const half = await page.request.patch(`/api/menu/${item.id}`, { data: { highlights: [{ label: "Weight", value: "" }] } });
    expect(half.status()).toBe(400);
    const mark = await page.request.patch(`/api/menu/${item.id}`, { data: { foodType: "VEGAN" } });
    expect(mark.status()).toBe(400);

    // In the form: one more highlight from a suggested label.
    await page.goto("/menu");
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const form = page.getByRole("dialog");
    await expect(form.getByTestId("highlight-row")).toHaveCount(1);
    await expect(form.getByRole("radio", { name: "Veg", exact: true })).toBeChecked();
    await form.getByRole("button", { name: "Spice level" }).click();
    await form.getByRole("textbox", { name: "Highlight 2 value" }).fill("Medium");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Menu item updated")).toBeVisible();

    const menu = (await (await page.request.get("/api/menu")).json()) as {
      data: { id: string; highlights: unknown; details: string | null; foodType: string | null }[];
    };
    const row = menu.data.find((m) => m.id === item.id);
    expect(row?.highlights).toEqual([
      { label: "Serves", value: "2 people" },
      { label: "Spice level", value: "Medium" },
    ]);
    expect(row?.details).toBe(details);
    expect(row?.foodType).toBe("VEG");

    const { slug } = await openStoreForMenuOrders(page);
    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      // The mark is drawn before the name and said after it.
      const trigger = buyer.getByRole("button", { name: new RegExp(`^${name}`) });
      await expect(trigger.locator('[data-food-mark="VEG"]')).toHaveCount(1);
      await expect(trigger).toHaveAccessibleName(new RegExp(`^${name} [(]Veg[)]`));
      expect(await buyer.content(), "cost never reaches the store page").not.toMatch(/costInPaise|98765|987\.65/);

      await trigger.click();
      const sheet = buyer.getByRole("dialog", { name });
      await expect(sheet.getByText("Veg", { exact: true })).toBeVisible();
      const highlights = sheet.getByRole("region", { name: "Highlights" });
      await expect(highlights.getByRole("term")).toHaveText(["Serves", "Spice level"]);
      await expect(highlights.getByRole("definition")).toHaveText(["2 people", "Medium"]);
      const detailText = sheet.getByRole("region", { name: "Details" });
      await expect(detailText).toContainText("Marinated overnight in hung curd.");
      await expect(detailText).toContainText("Grilled to order in the tandoor.");
    } finally {
      await ctx.close();
    }
  });
});
