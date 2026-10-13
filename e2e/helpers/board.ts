import { expect, type Locator, type Page } from "@playwright/test";

import { isPhoneLayout } from "./nav";

/**
 * The orders board (`/orders`): the header keeps Refresh on screen
 * at every width. Everything else (Edit, Prep sheet, the share buttons, My
 * store, Settings, Sound, phone alerts) sits beside it from `md`, and inside
 * the "More actions" bottom sheet on a phone. Specs run in both projects, so
 * reach those controls through `boardHeaderAction` instead of assuming one layout.
 */

const SHEET_NAME = "More actions";

function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: SHEET_NAME });
}

/**
 * A header control by role and exact accessible name. On a phone this opens
 * the "More actions" sheet first (unless it is already open) and looks inside
 * it; from `md` it looks in the page's <main>, which keeps it apart from the
 * shell navigation's own "Settings" link.
 */
export async function boardHeaderAction(
  page: Page,
  role: "link" | "button",
  name: string,
): Promise<Locator> {
  if (!isPhoneLayout(page)) return page.locator("#main").getByRole(role, { name, exact: true });
  const dialog = sheet(page);
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: SHEET_NAME, exact: true }).click();
    await expect(dialog).toBeVisible();
  }
  return dialog.getByRole(role, { name, exact: true });
}

/** Phone only: close the "More actions" sheet again so the board behind it can be used. No-op from `md`. */
export async function closeBoardActions(page: Page): Promise<void> {
  if (!isPhoneLayout(page)) return;
  const dialog = sheet(page);
  if (!(await dialog.isVisible())) return;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
