import { expect, type APIRequestContext, type Page } from "@playwright/test";

const E2E_PASSWORD = "E2e_billing_Rzp9!";

/**
 * Register a new vendor (OWNER) via public API and sign in through the UI.
 * Uses a unique email so tests can run repeatedly and in parallel projects.
 */
export async function registerOwnerAndSignIn(page: Page, request: APIRequestContext): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("awz_cookie_pref_v1", "accepted");
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `e2e-rzp-${suffix}@example.com`;

  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      password: E2E_PASSWORD,
      name: "E2E Billing Vendor",
      stallName: `E2E Stall ${suffix}`,
      stallType: "STREET_FOOD",
      phone: "+919876543210",
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.status(), "register should succeed when DB is available").toBe(201);

  await page.goto("/sign-in?callbackUrl=/settings/billing");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/sign-in"), { timeout: 45_000 });
  await expect(page).toHaveURL(/\/settings\/billing/);
}
