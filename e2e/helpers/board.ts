import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The orders board (`/orders`): Share and "More actions" (⋯) are menus in the
 * header at every width. Share holds the share actions and Open store; "⋯" holds
 * Order settings, plus a drop's Edit and prep sheet. Refresh, Sound and phone
 * alerts sit in the live sync bar.
 */

export type BoardMenu = "Share" | "More actions";

/** An item of a header menu by exact name, opening that menu unless it is already open. */
export async function boardMenuItem(page: Page, menu: BoardMenu, name: string): Promise<Locator> {
  const trigger = page.locator("#main").getByRole("button", { name: menu, exact: true });
  const item = page.getByRole("menu").getByRole("menuitem", { name, exact: true });
  // The menus load after the board (next/dynamic), so a click can land on the
  // server-rendered button before React handles it. Click until the menu is open.
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  return item;
}

/** Close whichever header menu is open, so the board behind it can be used. */
export async function closeBoardMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
