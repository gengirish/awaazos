import { expect, test, type Page } from "@playwright/test";

import { shellSignOutButton } from "./helpers/nav";
import { createMenuItem, createVendorSession, signIn, type VendorCreds } from "./helpers/vendor";

/**
 * Store owners / staff can sign out of the vendor app from the app shell's
 * navigation on every page (the "More" sheet on phones, the rail on md+) and
 * from the Settings hub, and are warned first when this device still holds
 * POS sales that haven't synced.
 *
 * Writes rows — throwaway DB only (see CLAUDE.md).
 */

async function expectSignedOut(page: Page): Promise<void> {
  await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 30_000 });
  // The session is really gone: protected pages bounce back to sign-in.
  await page.goto("/pos");
  await page.waitForURL((u) => u.pathname === "/sign-in");
  await page.goto("/settings");
  await page.waitForURL((u) => u.pathname === "/sign-in");
  expect((await page.request.get("/api/vendor")).status()).toBe(401);
}

async function signBackIn(page: Page, creds: VendorCreds): Promise<void> {
  await signIn(page, creds, "/pos");
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();
}

test.describe("vendor sign-out", () => {
  test("shell navigation on POS: sign out, protected pages redirect, signing back in lands on POS", async ({
    page,
    request,
  }) => {
    const creds = await createVendorSession(page, request, "vsignout-pos", "/pos");
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();

    const signOut = await shellSignOutButton(page);
    await expect(signOut).toBeVisible();
    const box = await signOut.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await signOut.click();
    await expectSignedOut(page);

    // Sign in again: the awz_vendor cookie is re-derived from the oldest membership.
    await signBackIn(page, creds);
    const vendor = await page.request.get("/api/vendor");
    expect(vendor.status()).toBe(200);
  });

  test("shell navigation on Settings and the Settings hub Account row both sign out", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "vsignout-set", "/settings");

    // 1) The shell's Sign out, from a Settings page.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await (await shellSignOutButton(page)).click();
    await expectSignedOut(page);

    // 2) Hub "Account" section.
    await signIn(page, creds, "/settings");
    await page.goto("/settings");
    const account = page.getByRole("region", { name: "Account" });
    await expect(account).toContainText("Signed in as");
    await expect(account).toContainText(creds.email);
    await account.getByRole("button", { name: "Sign out", exact: true }).click();
    await expectSignedOut(page);
  });

  test("warns about unsynced POS sales; Cancel stays signed in, Sign out anyway signs out", async ({
    page,
    request,
  }) => {
    const creds = await createVendorSession(page, request, "vsignout-pend", "/pos");
    await createMenuItem(page, { name: "Cutting Chai", priceInRupees: 10 });

    // Every sale POST fails like a dead network, so the sale stays queued in
    // this device's IndexedDB outbox and nothing can sync it behind our back.
    await page.route("**/api/transactions**", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );

    await page.goto("/pos");
    await page.getByRole("button", { name: /^Cutting Chai/ }).click();
    await page.getByRole("button", { name: "Collect payment" }).click();
    const payDialog = page.getByRole("dialog");
    await payDialog.getByRole("button", { name: "Cash" }).click();
    await payDialog.getByRole("button", { name: /Mark as paid/ }).click();
    await expect(page.getByText("Offline #1")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /New order/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Cancel (focused by default) keeps the session. On a phone the warning
    // opens on top of the "More" sheet, which stays open underneath.
    await (await shellSignOutButton(page)).click();
    const warn = page.getByRole("dialog", { name: "Sales waiting to sync" });
    await expect(warn).toBeVisible();
    await expect(warn).toContainText("1 sale from this device hasn't synced yet.");
    await expect(warn).toContainText(`signs in to ${creds.stallName} here`);
    const cancel = warn.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(warn).toHaveCount(0);
    await expect(page).toHaveURL(/\/pos$/);
    expect((await page.request.get("/api/vendor")).status()).toBe(200);

    // The shell warns on every page, not only on the POS.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await (await shellSignOutButton(page)).click();
    await expect(warn).toBeVisible();
    await warn.getByRole("button", { name: "Cancel" }).click();
    await expect(warn).toHaveCount(0);

    // Sign out anyway.
    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();
    await (await shellSignOutButton(page)).click();
    await page
      .getByRole("dialog", { name: "Sales waiting to sync" })
      .getByRole("button", { name: "Sign out anyway" })
      .click();
    await expectSignedOut(page);
  });
});
