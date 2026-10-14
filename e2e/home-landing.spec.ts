import { expect, test, type Browser, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createVendorSession, registerVendor, signIn, type VendorCreds } from "./helpers/vendor";

/**
 * Where a signed-in vendor lands (lib/home.ts, app/home/page.tsx):
 *
 *   setup not finished    → /onboarding
 *   storefront published  → /orders
 *   everyone else         → /pos
 *
 * Sign-in with no callbackUrl and the installed app's start_url (/home) both
 * go through that one resolver; an explicit callbackUrl still wins.
 *
 * Writes rows — throwaway DB only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

async function patchVendor(page: Page, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch("/api/vendor", { data, headers: JSON_HEADERS });
  expect(res.status(), `PATCH /api/vendor ${JSON.stringify(data)}`).toBe(200);
}

/**
 * Sign in through the form in a brand-new browser context, with no
 * callbackUrl at all — what a vendor does from a bookmark or the marketing
 * site. Returns the page once it has left /sign-in and stopped redirecting.
 */
async function signInWithNoCallback(browser: Browser, creds: VendorCreds, path = "/sign-in"): Promise<Page> {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("awz_cookie_pref_v1", "accepted");
  });
  await page.goto(path);
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => u.pathname !== "/sign-in" && u.pathname !== "/home", { timeout: 60_000 });
  return page;
}

test.describe("landing screen", () => {
  test("the manifest opens the installed app on the resolver, under the same app id", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { id: string; start_url: string; scope: string };
    expect(manifest.start_url).toBe("/home");
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  test("/home needs a session", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a store that has not finished setup lands on onboarding", async ({ page, request, browser }) => {
    const creds = await registerVendor(request, "home-setup");

    const fresh = await signInWithNoCallback(browser, creds);
    try {
      await expect(fresh).toHaveURL(/\/onboarding$/);
      await expect(fresh.getByRole("heading", { name: "Set up your store" })).toBeVisible();
    } finally {
      await fresh.context().close();
    }

    // The same answer straight from the resolver (the Home Screen icon).
    await signIn(page, creds, "/menu");
    await page.goto("/home");
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("a counter-only store lands on the POS", async ({ page, request, browser }) => {
    const creds = await createVendorSession(page, request, "home-counter");
    await patchVendor(page, { onboardingDone: true });

    await page.goto("/home");
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByRole("heading", { name: creds.stallName })).toBeVisible();

    const fresh = await signInWithNoCallback(browser, creds);
    try {
      await expect(fresh).toHaveURL(/\/pos$/);
      await expect(fresh.getByRole("heading", { name: creds.stallName })).toBeVisible();
    } finally {
      await fresh.context().close();
    }
  });

  test("a published store lands on Orders, and unpublishing sends it back to the POS", async ({
    page,
    request,
    browser,
  }) => {
    const creds = await createVendorSession(page, request, "home-published");
    await patchVendor(page, { onboardingDone: true, publishStorefront: true });

    await page.goto("/home");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { level: 1, name: "Orders", exact: true })).toBeVisible();

    const fresh = await signInWithNoCallback(browser, creds);
    try {
      await expect(fresh).toHaveURL(/\/orders$/);
      await expect(fresh.getByRole("heading", { level: 1, name: "Orders", exact: true })).toBeVisible();
    } finally {
      await fresh.context().close();
    }

    // The rule reads the setting on every visit; nothing is remembered.
    await patchVendor(page, { publishStorefront: false });
    await page.goto("/home");
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("an explicit callbackUrl still wins over the landing rule", async ({ page, request, browser }) => {
    const creds = await createVendorSession(page, request, "home-deeplink");
    await patchVendor(page, { onboardingDone: true, publishStorefront: true });

    // Published, so the rule alone would say /orders.
    const fresh = await signInWithNoCallback(browser, creds, "/sign-in?callbackUrl=%2Fmenu");
    try {
      await expect(fresh).toHaveURL(/\/menu$/);
    } finally {
      await fresh.context().close();
    }

    const pos = await signInWithNoCallback(browser, creds, "/sign-in?callbackUrl=%2Fpos");
    try {
      await expect(pos).toHaveURL(/\/pos$/);
      await expect(pos.getByRole("heading", { name: creds.stallName })).toBeVisible();
    } finally {
      await pos.context().close();
    }
  });
});
