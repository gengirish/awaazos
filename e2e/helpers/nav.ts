import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The signed-in app shell (components/shell): a bottom tab bar below Tailwind's
 * `md` breakpoint, a left rail from `md` up. Specs run in both a desktop and a
 * phone project, so they reach navigation through these helpers instead of
 * assuming one layout.
 */

const MD_PX = 768;

/** True when the page's current viewport gets the phone tab bar rather than the rail. */
export function isPhoneLayout(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < MD_PX;
}

/** The shell's main navigation that is on screen at the current viewport. */
export function mainNav(page: Page): Locator {
  return page.getByTestId(isPhoneLayout(page) ? "app-tabbar" : "app-rail");
}

/** Phone only: open the "More" bottom sheet and return it. */
export async function openMoreSheet(page: Page): Promise<Locator> {
  await mainNav(page).getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Where Transactions, Analytics, Settings, Help, Live store and Sign out live: the
 * "More" sheet on a phone (opened here), the rail itself on md+.
 */
export async function secondaryNav(page: Page): Promise<Locator> {
  return isPhoneLayout(page) ? openMoreSheet(page) : mainNav(page);
}

/** The shell's Sign out button, opening the "More" sheet first on a phone. */
export async function shellSignOutButton(page: Page): Promise<Locator> {
  return (await secondaryNav(page)).getByRole("button", { name: "Sign out", exact: true });
}
