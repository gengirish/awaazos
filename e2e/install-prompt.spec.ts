import { expect, test, type Page } from "@playwright/test";

import { secondaryNav } from "./helpers/nav";
import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * "Install AwaazOS" (components/pwa/InstallPrompt.tsx, hooks/useInstallPrompt.ts).
 *
 * Playwright's Chromium never offers a real install, so the browser's
 * `beforeinstallprompt` is stood in for by a synthetic event carrying the same
 * two members the app uses (`prompt()` and `userChoice`). What is tested is
 * ours: where the affordance shows, that a tap calls `prompt()` once, and that
 * dismissing the banner sticks on this device while the menu entry stays.
 *
 * Writes rows — throwaway DB only (see CLAUDE.md).
 */

const BANNER = "install-banner";

/**
 * Fire a stand-in `beforeinstallprompt` until the app has picked it up. The
 * page's heading is server-rendered, so it can be visible before the bundle
 * that listens has loaded; retrying the dispatch covers that gap.
 */
async function offerInstall(page: Page, seenBy: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __installPrompts?: number };
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: () => {
          w.__installPrompts = (w.__installPrompts ?? 0) + 1;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(event);
    });
    await seenBy();
  }).toPass({ timeout: 30_000 });
}

test.describe("install prompt", () => {
  test("no install banner on the home screens when the browser offers no install", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "install-none", "/pos");
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();
    // The banner only ever renders after mount, so wait for proof the page has
    // hydrated: today's total is masked ("₹ ••••") until the client has read
    // this device's preference.
    await expect(page.locator("header").getByText("••••")).toHaveCount(0);
    await expect(page.getByTestId(BANNER)).toHaveCount(0);

    await page.goto("/orders");
    await expect(page.getByRole("heading", { level: 1, name: "Online orders" })).toBeVisible();
    // Same here: "Last checked" only appears once a tap on Refresh has been handled.
    await expect(async () => {
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByText(/^Last checked/)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId(BANNER)).toHaveCount(0);
    await expect((await secondaryNav(page)).getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
  });

  test("an offered install shows the banner; tapping it opens the browser's prompt once", async ({
    page,
    request,
  }) => {
    const creds = await createVendorSession(page, request, "install-tap", "/pos");
    await createMenuItem(page, { name: "Poha", priceInRupees: 30 });
    await page.reload();
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();

    const banner = page.getByTestId(BANNER);
    await offerInstall(page, () => expect(banner).toBeVisible({ timeout: 2_000 }));
    await expect(banner).toContainText("Install AwaazOS");

    // In flow above the menu: a 44px-tall control that the tab bar does not cover.
    const install = banner.getByRole("button", { name: "Install app", exact: true });
    const dismiss = banner.getByRole("button", { name: "Dismiss install tip" });
    for (const control of [install, dismiss]) {
      const box = await control.boundingBox();
      expect(box, "control should be laid out").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      "the banner must not make the page scroll sideways",
    ).toBe(true);

    await page.evaluate(() => {
      (window as unknown as { __installPrompts?: number }).__installPrompts = 0;
    });
    await install.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __installPrompts?: number }).__installPrompts))
      .toBe(1);
    // The browser's event is single-use: the affordance goes until it offers again.
    await expect(banner).toHaveCount(0);
  });

  test("dismissing the banner sticks on this device; the menu entry stays", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "install-dismiss", "/pos");
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();

    const banner = page.getByTestId(BANNER);
    await offerInstall(page, () => expect(banner).toBeVisible({ timeout: 2_000 }));
    await banner.getByRole("button", { name: "Dismiss install tip" }).click();
    await expect(banner).toHaveCount(0);

    // Same device, next visit, the browser offers again: no banner…
    await page.reload();
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();
    let nav = await secondaryNav(page);
    const entry = () => nav.getByRole("button", { name: "Install app", exact: true });
    // …but the shell still offers it (the "More" sheet on a phone, the rail from md).
    await offerInstall(page, () => expect(entry()).toBeVisible({ timeout: 2_000 }));
    await expect(banner).toHaveCount(0);

    // And on the other home screen too.
    await page.goto("/orders");
    await expect(page.getByRole("heading", { level: 1, name: "Online orders" })).toBeVisible();
    nav = await secondaryNav(page);
    await offerInstall(page, () => expect(entry()).toBeVisible({ timeout: 2_000 }));
    await expect(banner).toHaveCount(0);
  });
});
