import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, getVendorReferral } from "./helpers/billing-db";
import { E2E_PASSWORD, signIn } from "./helpers/vendor";

/**
 * "Refer a seller" (lib/referral.ts): a sign-up through /sign-up?ref=<slug>
 * is attributed to that store and gets the longer trial; a bad code never
 * fails sign-up. Writes vendors, so local throwaway databases only.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function unique(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `e2e-ref-${label}-${suffix}@example.com`,
    handle: `e2e-ref-${label}-${suffix}`.slice(0, 40),
    stallName: `E2E ref ${label} ${suffix}`,
  };
}

async function register(
  request: import("@playwright/test").APIRequestContext,
  who: ReturnType<typeof unique>,
  extra: Record<string, string> = {},
) {
  const res = await request.post("/api/auth/register", {
    data: {
      email: who.email,
      password: E2E_PASSWORD,
      name: "E2E Ref",
      stallName: who.stallName,
      storeHandle: who.handle,
      stallType: "HOME_KITCHEN",
      ...extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { vendorId: string; vendorSlug: string; referred?: boolean };
}

test.describe("referrals", () => {
  test("a sign-up with a store's code is attributed and gets the longer trial", async ({ request }) => {
    const referrer = unique("a");
    const a = await register(request, referrer, { phone: "+919812345601" });

    const friend = unique("b");
    const b = await register(request, friend, { ref: a.vendorSlug, phone: "+919812345602" });
    expect(b.referred).toBe(true);

    test.skip(!CAN_SET_BILLING, "needs a local database to read the vendor rows");
    const row = await getVendorReferral(friend.email);
    expect(row.referredByVendorId).toBe(a.vendorId);
    const days = ((row.trialEndsAt?.getTime() ?? 0) - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(59);
    expect(days).toBeLessThanOrEqual(60);
  });

  test("an unknown or self-referring code still signs up, unattributed, on the normal trial", async ({ request }) => {
    const unknown = await register(request, unique("c"), { ref: "no-such-store-zz9" });
    expect(unknown.referred).toBe(false);

    const owner = unique("d");
    const d = await register(request, owner, { phone: "+919812345603" });
    const sameEmailish = unique("e");
    // Same phone as the referrer: treated as a self-referral.
    const self = await register(request, sameEmailish, { ref: d.vendorSlug, phone: "+919812345603" });
    expect(self.referred).toBe(false);

    test.skip(!CAN_SET_BILLING, "needs a local database to read the vendor rows");
    const row = await getVendorReferral(sameEmailish.email);
    expect(row.referredByVendorId).toBeNull();
    const days = ((row.trialEndsAt?.getTime() ?? 0) - Date.now()) / DAY_MS;
    expect(days).toBeLessThanOrEqual(30);
  });

  test("the sign-up page says the trial is longer when it carries a code", async ({ page }) => {
    await page.goto("/sign-up?ref=some-store");
    await expect(page.getByText(/invited by a seller/i)).toBeVisible();
    await expect(page.getByText(/60 days/i).first()).toBeVisible();
  });

  test("the owner finds their link in Settings → Refer a seller", async ({ page, request }) => {
    const owner = unique("f");
    const a = await register(request, owner, { phone: "+919812345604" });
    await signIn(page, { email: owner.email, password: E2E_PASSWORD, stallName: owner.stallName }, "/settings/refer");
    await expect(page.getByRole("heading", { name: /refer a seller/i }).first()).toBeVisible();
    await expect(page.getByText(`ref=${a.vendorSlug}`).first()).toBeVisible();
  });
});
