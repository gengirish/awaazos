import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * Colour contrast (WCAG 2 AA) on the pages buyers and new sellers meet first:
 * the landing page, a store page and its checkout. axe reads the browser's
 * computed colours, so the OKLCH / HSL tokens in app/globals.css are resolved
 * the same way a phone resolves them. Decorative mockups (aria-hidden) are left
 * out: they are pictures of the product, not text anyone has to read.
 */

async function contrastViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withRules(["color-contrast"]).exclude("[aria-hidden='true']");
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  // One line per failing element: what it says and its measured ratio, so a failure reads without the trace.
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(" ")} — ${n.any[0]?.message ?? v.help}`),
  );
}

test.describe("colour contrast (axe)", () => {
  test("landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await contrastViolations(page)).toEqual([]);
  });

  test("store page and checkout", async ({ page, request, browser }) => {
    test.slow();
    await createVendorSession(page, request, "contrast", "/menu");
    await createMenuItem(page, { name: "Ragi laddu", priceInRupees: 40, category: "Sweets" });
    const { slug } = await openStoreForMenuOrders(page);

    const ctx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await ctx.newPage();
      await buyer.goto(`/s/${slug}`);
      await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await contrastViolations(buyer)).toEqual([]);

      await buyer.getByRole("button", { name: /^Add/ }).first().click();
      await buyer.getByRole("button", { name: "Checkout", exact: true }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();
      expect(await contrastViolations(buyer, "[role='dialog']")).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
