import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { signIn } from "./vendor";

const E2E_PASSWORD = "E2e_billing_Rzp9!";

/**
 * Register a new vendor (OWNER) via public API and sign in through the UI.
 * Uses a unique email so tests can run repeatedly and in parallel projects.
 */
export async function registerOwnerAndSignIn(page: Page, request: APIRequestContext): Promise<void> {
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

  // The shared sign-in also finishes first-run setup, which every vendor page now requires.
  await signIn(page, { email, password: E2E_PASSWORD, stallName: `E2E Stall ${suffix}` }, "/settings/billing");
  await expect(page).toHaveURL(/\/settings\/billing/);
}
