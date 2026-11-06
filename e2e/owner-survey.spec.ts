import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, setPlatformRole, setStaffRole } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createVendorSession, registerVendor, signIn } from "./helpers/vendor";

/**
 * Owner survey (lib/owner-survey.ts) and a store's own price (lib/subscription.ts):
 * the owner answers, an admin reads the answers and sets a price, the owner sees
 * that price when subscribing.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

const ANSWERS = {
  pains: ["delivery"],
  topPain: "delivery",
  weeklyOrders: "10_30",
  maxWeeklyOrders: "30_80",
  willingToPay: "199_499",
};

test.describe("owner survey", () => {
  test("an owner is asked, answers, and is not asked again", async ({ page, request }) => {
    test.slow();
    await createVendorSession(page, request, "survey-owner");

    await page.goto("/orders");
    const prompt = page.getByRole("complementary", { name: "Owner survey" });
    await prompt.getByRole("link", { name: "Answer now" }).click();
    await expect(page.getByRole("heading", { name: "Tell us what's hard" })).toBeVisible();
    await expect(page.getByText(/may use it to offer your store a price/)).toBeVisible();

    // Incomplete: says so and saves nothing.
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "first four questions" })).toBeVisible();

    await page.getByLabel("Checking who has paid").check();
    await page.getByLabel("Booking delivery and briefing riders").check();
    await page.getByRole("group", { name: "Which one hurts most?" }).getByLabel("Checking who has paid").check();
    await page.getByRole("group", { name: /how many orders/ }).getByLabel("30 to 80").check();
    await page.getByRole("group", { name: /most orders you can handle/ }).getByLabel("80 to 200").check();
    await page.getByRole("group", { name: /what would you pay/ }).getByLabel("₹199 to ₹499").check();
    await page.getByLabel(/Anything else we should build/).fill("Rider tracking");
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thank you" })).toBeVisible();

    await page.goto("/orders");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Owner survey" })).toHaveCount(0);

    await page.goto("/settings/survey");
    await expect(page.getByRole("button", { name: "Update my answers" })).toBeVisible();
    await expect(page.getByLabel(/Anything else we should build/)).toHaveValue("Rider tracking");
  });

  test("Not now hides the prompt on this device", async ({ page, request }) => {
    await createVendorSession(page, request, "survey-later");
    await page.goto("/orders");
    const prompt = page.getByRole("complementary", { name: "Owner survey" });
    await prompt.getByRole("button", { name: "Not now" }).click();
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Owner survey" })).toHaveCount(0);
  });

  test("signed out gets 401, and a body naming another store still writes only your own", async ({ page, request }) => {
    const anonymous = await request.put("/api/vendor/survey", { data: ANSWERS, headers: JSON_HEADERS });
    expect(anonymous.status()).toBe(401);

    await createVendorSession(page, request, "survey-tenant");
    const res = await page.request.put("/api/vendor/survey", {
      data: { ...ANSWERS, vendorId: "someone-elses-store" },
      headers: JSON_HEADERS,
    });
    expect(res.status()).toBe(200);
  });

  test.describe("with roles set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a role");

    test("staff are not asked and can't answer", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "survey-staff");
      await setStaffRole(creds.email, "MANAGER");

      await page.goto("/orders");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Owner survey" })).toHaveCount(0);

      const res = await page.request.put("/api/vendor/survey", { data: ANSWERS, headers: JSON_HEADERS });
      expect(res.status()).toBe(403);

      await page.goto("/settings/survey");
      await expect(page).toHaveURL(/\/settings$/);
    });
  });
});

test.describe("public survey link", () => {
  test("anyone can answer with no sign-in", async ({ page }) => {
    await page.goto("/survey");
    await expect(page).toHaveURL(/\/survey$/);
    await expect(page.getByRole("heading", { name: "Tell us what's hard" })).toBeVisible();
    await expect(page.getByText(/may use it to offer your store a price/)).toHaveCount(0);

    await page.getByLabel("Finding new customers").check();
    await page.getByRole("group", { name: /how many orders/ }).getByLabel("Under 10").check();
    await page.getByRole("group", { name: /most orders you can handle/ }).getByLabel("10 to 30").check();
    await page.getByRole("group", { name: /what would you pay/ }).getByLabel("Nothing yet").check();
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thank you" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send my answers" })).toHaveCount(0);
  });

  test("the API rejects a bad answer and takes a good one", async ({ request }) => {
    const bad = await request.post("/api/survey", {
      data: { ...ANSWERS, topPain: "overselling" },
      headers: JSON_HEADERS,
    });
    expect(bad.status()).toBe(400);

    const good = await request.post("/api/survey", { data: ANSWERS, headers: JSON_HEADERS });
    expect(good.status()).toBe(201);
  });
});

test.describe("a store's own price", () => {
  test("a store owner with no platform role gets 404 from the pages and the API", async ({ page, request }) => {
    await createVendorSession(page, request, "price-none");

    expect((await page.goto("/admin/survey"))?.status()).toBe(404);
    const api = await page.request.patch("/api/admin/vendors/anything/price", {
      data: { monthlyRupees: 199 },
      headers: JSON_HEADERS,
    });
    expect(api.status()).toBe(404);
  });

  test.describe("with roles set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

    test("a platform ADMIN can't read the survey or set a price", async ({ page, request }) => {
      const creds = await createVendorSession(page, request, "price-admin");
      await setPlatformRole(creds.email, "ADMIN");

      expect((await page.goto("/admin/survey"))?.status()).toBe(404);
      const api = await page.request.patch("/api/admin/vendors/anything/price", {
        data: { monthlyRupees: 199 },
        headers: JSON_HEADERS,
      });
      expect(api.status()).toBe(404);
    });

    test("a super admin reads a store's answers, sets its price, and the owner sees it", async ({
      page,
      request,
      browser,
    }) => {
      // Two sign-ins and several screens; `next dev` compiles each on first hit.
      test.slow();

      const store = await registerVendor(request, "price-store");
      const ownerContext = await browser.newContext(CONTEXT_OPTIONS);
      const ownerPage = await ownerContext.newPage();
      await signIn(ownerPage, store, "/settings/billing");
      await expect(ownerPage.getByText(/You pay ₹765.82 with GST/)).toBeVisible();

      const saved = await ownerPage.request.put("/api/vendor/survey", {
        data: { ...ANSWERS, comment: "Rider tracking" },
        headers: JSON_HEADERS,
      });
      expect(saved.status()).toBe(200);

      const publicComment = `From the public link ${Date.now()}`;
      const publicAnswer = await request.post("/api/survey", {
        data: { ...ANSWERS, comment: publicComment },
        headers: JSON_HEADERS,
      });
      expect(publicAnswer.status()).toBe(201);

      const admin = await registerVendor(request, "price-super");
      await setPlatformRole(admin.email, "SUPER_ADMIN");
      await signIn(page, admin, "/admin/survey");

      await expect(page.getByRole("region", { name: "From the public link" })).toContainText(publicComment);

      await expect(page.getByRole("row", { name: /Booking delivery and briefing riders/ }).first()).toBeVisible();
      const answer = page.getByRole("listitem").filter({ hasText: store.stallName });
      await expect(answer).toContainText("Rider tracking");
      await answer.getByRole("link", { name: "Set price" }).click();

      const row = page.getByRole("listitem").filter({ hasText: store.stallName });
      await expect(row).toContainText("Booking delivery and briefing riders");
      await expect(row).toContainText("On the list price");

      // Out of range never reaches the dialog.
      const price = row.getByLabel(/Store price/);
      await price.fill("10");
      await row.getByRole("button", { name: "Save price" }).click();
      await expect(row.getByRole("alert")).toContainText("whole rupees");

      await price.fill("199");
      await expect(row).toContainText("₹234.82 a month");
      await row.getByRole("button", { name: "Save price" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("₹199 a month + GST");
      await dialog.getByRole("button", { name: "Save price" }).click();
      await expect(row.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
      await expect(row).toContainText("Store price: ₹199 a month");

      // The owner's billing page now carries the store's price, both cycles.
      await ownerPage.reload();
      await expect(ownerPage.getByText(/You pay ₹234.82 with GST/)).toBeVisible();
      await ownerPage.getByRole("radio", { name: /^Yearly/ }).check();
      await expect(ownerPage.getByText(/You pay ₹2,348.20 with GST/)).toBeVisible();

      // And back: the list price again.
      await row.getByRole("button", { name: "Back to list price" }).click();
      await dialog.getByRole("button", { name: "Save price" }).click();
      await expect(row).toContainText("On the list price");
      await ownerPage.reload();
      await expect(ownerPage.getByText(/You pay ₹765.82 with GST/)).toBeVisible();

      await ownerContext.close();
    });
  });
});
