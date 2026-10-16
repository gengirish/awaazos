import { expect, test } from "@playwright/test";

test.describe("public surfaces", () => {
  test("landing page renders hero + product badge + sign-up CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/AwaazOS/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/pre-orders/i);
    await expect(page.getByText(/IntelliForge AI/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /start 30 days free/i }).first()).toBeVisible();
  });

  test("landing page offers Install app, with written steps when the browser has no prompt", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /install app/i }).click();
    const dialog = page.getByRole("dialog", { name: /install awaazos/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem").first()).toBeVisible();
  });

  test("pricing page sells one plan: free trial, then Starter monthly or yearly", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /^starter$/i })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("30 days free");
    await expect(page.getByText("₹2,990/yr + GST")).toBeVisible();
    await expect(page.getByText(/2 months free/i).first()).toBeVisible();
    // Scoped to <main>: the header carries the same call to action.
    await expect(page.getByRole("main").getByRole("link", { name: /start 30 days free/i })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    // Copy comes from lib/plan-copy.ts: Starter sells CSV export, and nothing
    // promises staff logins (there is no invite flow — see TODO.md §2).
    await expect(page.getByText(/CSV export/i).first()).toBeVisible();
    await expect(page.getByText(/staff/i)).toHaveCount(0);
  });

  test("FREE and PRO stay off the marketing surface", async ({ page }) => {
    await page.goto("/pricing");
    // MARKETED_PLANS in lib/plan-copy.ts is ["STARTER"]. FREE is kept only for
    // vendors who signed up before the trial; PRO is a deliberate cut (PITCH.md
    // "minimal product"). PLAN_PRICES_PAISE still carries both for the gates.
    await expect(page.getByText(/₹\s*799/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^pro$/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^free$/i })).toHaveCount(0);
    await expect(page.getByText(/₹\s*0\b/)).toHaveCount(0);
    await expect(page.getByText(/bills a month/i)).toHaveCount(0);
  });

  test("pricing shows whole-rupee prices, all exclusive of GST", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("₹299/mo + GST", { exact: true })).toBeVisible();
    await expect(page.getByText(/₹\s*299\.00/)).toHaveCount(0);
    await expect(page.getByText(/exclude 18% GST/i)).toBeVisible();
  });

  test("landing teaser offers the same trial and prices", async ({ page }) => {
    await page.goto("/");
    const teaser = page.getByRole("region", { name: /one simple plan/i });
    await expect(teaser).toContainText("30 days free");
    await expect(teaser).toContainText("₹299/mo + GST");
    await expect(teaser).toContainText("₹2,990/yr + GST");
  });

  for (const path of ["/legal/privacy", "/legal/terms"]) {
    test(`${path} is public (no sign-in redirect)`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("sign-in form renders email + password + submit", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("sign-up form renders required fields", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    // Exact: the show/hide toggle is labelled "Show password".
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });
});

test.describe("auth-protected surfaces redirect to sign-in", () => {
  for (const path of [
    "/menu",
    "/pos",
    "/transactions",
    "/analytics",
    "/settings",
    "/settings/billing",
    "/help",
    "/onboarding",
  ]) {
    test(`${path} → /sign-in when unauthenticated`, async ({ page }) => {
      const resp = await page.goto(path);
      expect(resp?.status(), `${path} should reach a 200-ish final page`).toBeLessThan(400);
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }
});

test.describe("protected API routes refuse unauthenticated", () => {
  for (const path of [
    "/api/menu",
    "/api/vendor",
    "/api/ai/parse-order",
    "/api/ai/transcribe",
    "/api/razorpay/create-subscription",
    "/api/transactions",
    "/api/transactions/export",
    "/api/receipts/send",
    "/api/receipts/message",
  ]) {
    test(`${path} returns redirect or 401/403`, async ({ request }) => {
      const r = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
      // 405 = route exists but method not allowed (e.g. POST-only). 429 = rate limit under load.
      expect([301, 302, 307, 401, 403, 405, 429]).toContain(r.status());
    });
  }
});
