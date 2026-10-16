import { expect, test, type APIRequestContext } from "@playwright/test";

import { E2E_PASSWORD, registerVendor, signIn } from "./helpers/vendor";

/**
 * Registration, sign-in and password reset.
 *
 * The reset assertions are security assertions, not UX ones: the whole design
 * of /api/auth/forgot-password is that an attacker cannot tell a real account
 * from a fake one, so the tests compare responses for equality rather than
 * checking either one in isolation.
 */

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
}

function registrationBody(email: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    password: E2E_PASSWORD,
    name: "E2E Auth",
    stallName: `E2E Auth ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stallType: "STREET_FOOD",
    phone: "+919876543210",
    ...overrides,
  };
}

async function register(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post("/api/auth/register", {
    data: body,
    headers: { "Content-Type": "application/json" },
    failOnStatusCode: false,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

test.describe("registration", () => {
  test("a duplicate email is a 409, not a 500", async ({ request }) => {
    const email = uniqueEmail("dup");

    const first = await register(request, registrationBody(email));
    expect(first.status, "first registration should succeed").toBe(201);

    // Same email, different stall — the unique constraint is on User.email, and
    // route maps Prisma P2002 to 409 rather than letting it surface as a 500.
    const second = await register(request, registrationBody(email));
    expect(second.status).toBe(409);
    expect(typeof second.body.error).toBe("string");
  });

  test("a weak password is refused before any account is created", async ({ request }) => {
    const email = uniqueEmail("weak");

    const weak = await register(request, registrationBody(email, { password: "password" }));
    expect(weak.status).toBe(400);
    expect(typeof weak.body.error).toBe("string");

    // Proof it was refused rather than silently created: the same email still
    // registers cleanly afterwards.
    const retry = await register(request, registrationBody(email));
    expect(retry.status, "the rejected attempt must not have created a user").toBe(201);
  });

  test("a malformed phone is refused", async ({ request }) => {
    const bad = await register(request, registrationBody(uniqueEmail("phone"), { phone: "12345" }));
    expect(bad.status).toBe(400);
  });
});

test.describe("sign-in", () => {
  test("a wrong password keeps you on /sign-in with an alert, and never sets a session", async ({
    page,
    request,
  }) => {
    const creds = await registerVendor(request, "signin");

    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill("Definitely-Not-The-Password-9!");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Scoped by text: Next renders its own role="alert" route announcer, so a
    // bare getByRole("alert") is ambiguous.
    const alert = page.locator('[role="alert"]', { hasText: /invalid email or password/i });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    // The real check: no session was minted, so a protected route still bounces.
    const res = await page.request.get("/api/vendor", { failOnStatusCode: false });
    expect(res.status()).toBe(401);
  });

  test("correct credentials reach the requested callback target", async ({ page, request }) => {
    const creds = await registerVendor(request, "signin-ok");
    await signIn(page, creds, "/menu");
    await expect(page).toHaveURL(/\/menu/);

    const res = await page.request.get("/api/vendor");
    expect(res.status()).toBe(200);
  });
});

test.describe("password reset must not enumerate accounts", () => {
  test("a known and an unknown email produce identical responses", async ({ request }) => {
    const creds = await registerVendor(request, "reset");

    const known = await request.post("/api/auth/forgot-password", {
      data: { email: creds.email },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    const unknown = await request.post("/api/auth/forgot-password", {
      data: { email: uniqueEmail("nobody") },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });

    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(known.status());
    expect(await unknown.text()).toBe(await known.text());
  });

  test("even a malformed body returns the same ok:true", async ({ request }) => {
    const res = await request.post("/api/auth/forgot-password", {
      data: { email: "not-an-email" },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("a garbage token gets the generic failure, never a reason", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      data: { token: "x".repeat(43), newPassword: "Brand-New-Pass-9!" },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid or expired token" });
  });

  test("a token below the schema minimum is indistinguishable from a wrong one", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/reset-password", {
      data: { token: "short", newPassword: "Brand-New-Pass-9!" },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid or expired token" });
  });

  test("a weak new password gets a SPECIFIC message — nothing left to enumerate", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/reset-password", {
      data: { token: "x".repeat(43), newPassword: "password" },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    // The policy check runs before the token lookup, so the caller learns why
    // the password is bad without learning whether the token was real.
    expect(body.error).not.toBe("Invalid or expired token");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
