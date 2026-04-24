import { expect, test } from "@playwright/test";

import { registerOwnerAndSignIn } from "./helpers/register-owner";

test.describe("Razorpay create-subscription API", () => {
  test("POST without session returns 401", async ({ request }) => {
    const res = await request.post("/api/razorpay/create-subscription", {
      data: { plan: "PRO" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/unauthorized/i);
  });

  test("POST without session returns 401 even with invalid plan body", async ({ request }) => {
    const res = await request.post("/api/razorpay/create-subscription", {
      data: { plan: "NOT_A_PLAN" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Billing page — upgrade calls create-subscription", () => {
  test("FREE owner sees Starter control; mocked API receives correct body", async ({
    page,
    request,
  }) => {
    const base = process.env.BASE_URL ?? "http://localhost:3000";
    let capturedBody: string | null = null;

    await page.route("**/api/razorpay/create-subscription", async (route) => {
      capturedBody = route.request().postData() ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          subscriptionId: "sub_e2e_mock",
          shortUrl: `${base}/pricing`,
        }),
      });
    });

    await registerOwnerAndSignIn(page, request);

    await expect(page.getByRole("heading", { name: /billing/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upgrade to starter/i })).toBeVisible();

    await page.getByRole("button", { name: /upgrade to starter/i }).click();

    await expect.poll(() => capturedBody, { timeout: 15_000 }).toBeTruthy();
    expect(JSON.parse(capturedBody!)).toEqual({ plan: "STARTER" });

    await page.waitForURL(/\/pricing/, { timeout: 15_000 });
  });
});
