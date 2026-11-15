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
});
