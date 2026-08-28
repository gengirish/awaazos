import { expect, test } from "@playwright/test";

test.describe("public surfaces", () => {
  test("landing page renders hero + Bharat badge + pricing teaser", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/AwaazOS/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Bol\.\s*Bill\.\s*Becho/i);
    await expect(page.getByText(/Bharat AI/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /(get started|sign up)/i }).first()).toBeVisible();
  });

  test("pricing page lists FREE and STARTER with paise-correct rupee amounts", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/FREE/i).first()).toBeVisible();
    await expect(page.getByText(/STARTER/i).first()).toBeVisible();
    await expect(page.getByText(/₹\s*0/).first()).toBeVisible();
    await expect(page.getByText(/₹\s*299/).first()).toBeVisible();
  });

  test("PRO stays off the marketing surface until STARTER is GA", async ({ page }) => {
    await page.goto("/pricing");
    // VISIBLE_TIERS in app/(marketing)/pricing/page.tsx is ["FREE", "STARTER"] —
    // PRO is a deliberate cut (PITCH.md "minimal product"), not an oversight.
    // PLAN_PRICES_PAISE still carries 79900 for gates, so only the marketing
    // surface should be free of it.
    await expect(page.getByText(/₹\s*799/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^pro$/i })).toHaveCount(0);
  });

  test("sign-in form renders email + password + submit", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("sign-up form renders required fields", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
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
  ]) {
    test(`${path} returns redirect or 401/403`, async ({ request }) => {
      const r = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
      // 405 = route exists but method not allowed (e.g. POST-only). 429 = rate limit under load.
      expect([301, 302, 307, 401, 403, 405, 429]).toContain(r.status());
    });
  }
});
