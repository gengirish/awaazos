import { expect, test } from "@playwright/test";

import { addMonthsYmd, formatYmd, istTodayYmd } from "../lib/admin-free-access";
import { CAN_SET_BILLING, daysFromNow, setPlatformRole, setVendorBilling } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createVendorSession, registerVendor, signIn } from "./helpers/vendor";

/**
 * Free access granted by a platform SUPER_ADMIN on /admin/vendors
 * (lib/admin-free-access.ts): it moves Vendor.trialEndsAt, nothing else.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const sixMonthsYmd = () => addMonthsYmd(istTodayYmd(), 6);

test.describe("admin free access", () => {
  test("a store owner with no platform role gets 404 from the page and the API", async ({ page, request }) => {
    await createVendorSession(page, request, "admin-none");

    const nav = await page.goto("/admin/vendors");
    expect(nav?.status()).toBe(404);

    const api = await page.request.patch("/api/admin/vendors/anything/free-access", {
      data: { freeUntil: sixMonthsYmd() },
      headers: JSON_HEADERS,
    });
    expect(api.status()).toBe(404);
  });

  test.describe("with roles set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

    test("a platform ADMIN can open metrics but not the stores page", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "admin-plain");
      await setPlatformRole(creds.email, "ADMIN");

      const metrics = await page.goto("/admin/metrics");
      expect(metrics?.status()).toBe(200);
      await expect(page.getByRole("link", { name: /stores and free access/i })).toHaveCount(0);

      const stores = await page.goto("/admin/vendors");
      expect(stores?.status()).toBe(404);
    });

    test("a super admin gives a locked store six months free", async ({ page, request, browser }) => {
      // Two sign-ins and four screens; `next dev` compiles each on first hit.
      test.slow();
      // The store: trial ended yesterday, so it is locked.
      const store = await registerVendor(request, "admin-store");
      await setVendorBilling(store.email, { trialEndsAt: daysFromNow(-1) });

      const admin = await registerVendor(request, "admin-super");
      await setPlatformRole(admin.email, "SUPER_ADMIN");
      await signIn(page, admin, `/admin/vendors?q=${encodeURIComponent(store.stallName)}`);

      const row = page.getByRole("listitem").filter({ hasText: store.stallName });
      await expect(row).toContainText(/locked since/i);

      const freeUntil = formatYmd(sixMonthsYmd());
      await row.getByRole("button", { name: "6 months" }).click();
      await expect(row.getByLabel("Free until")).toHaveValue(sixMonthsYmd());
      await row.getByRole("button", { name: "Give free access" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(`free access until ${freeUntil}`);
      await dialog.getByRole("button", { name: "Give free access" }).click();

      await expect(row.getByRole("status")).toHaveText(`Saved. Free until ${freeUntil}.`);
      await expect(row).toContainText(`Free until ${freeUntil}`);
      await expect(row).not.toContainText(/locked since/i);

      // The store owner sees the new date and can sell again.
      const storeContext = await browser.newContext(CONTEXT_OPTIONS);
      try {
        const storePage = await storeContext.newPage();
        await signIn(storePage, store, "/settings/billing");
        await expect(storePage.getByText(/starter — free trial/i)).toBeVisible();
        await expect(storePage.getByText(new RegExp(`\\d+ days left — ends on ${freeUntil}`))).toBeVisible();
        await expect(storePage.getByText(/of 30 days left/i)).toHaveCount(0);

        await storePage.goto("/pos");
        await expect(storePage.getByRole("heading", { name: /subscribe to keep selling/i })).toHaveCount(0);
      } finally {
        await storeContext.close();
      }
    });
  });
});
