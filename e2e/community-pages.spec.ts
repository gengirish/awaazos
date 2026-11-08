import { expect, test, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setPlatformRole } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createVendorSession, registerVendor, signIn } from "./helpers/vendor";

/**
 * Community pages (lib/community.ts): an admin-made public page at /c/<slug>
 * that lists a society's stores once each store's owner joins.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

async function publishedSlug(page: Page): Promise<string> {
  const res = await page.request.patch("/api/vendor", { data: { publishStorefront: true }, headers: JSON_HEADERS });
  expect(res.status(), "publish store").toBe(200);
  const body = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

test.describe("community pages", () => {
  test("an unknown community link is a 404", async ({ page }) => {
    const res = await page.goto("/c/zz-no-such-community");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /isn't available/i })).toBeVisible();
  });

  test("a store owner with no platform role gets 404 from the admin page and API", async ({ page, request }) => {
    await createVendorSession(page, request, "community-none");
    expect((await page.goto("/admin/communities"))?.status()).toBe(404);
    const api = await page.request.post("/api/admin/communities", {
      data: { slug: "nope-community", name: "Nope" },
      headers: JSON_HEADERS,
    });
    expect(api.status()).toBe(404);
  });

  test("a store can't accept or leave a page it was never invited to", async ({ page, request }) => {
    await createVendorSession(page, request, "community-stranger");
    const accept = await page.request.post("/api/vendor/communities/not-a-real-id");
    expect(accept.status()).toBe(404);
    const leave = await page.request.delete("/api/vendor/communities/not-a-real-id");
    expect(leave.status()).toBe(404);
  });

  test.describe("with roles set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

    test("admin invites two stores; only the one whose owner joins is listed", async ({ page, request, browser }) => {
      test.slow();
      const suffix = Date.now().toString(36);
      const communitySlug = `e2e-society-${suffix}`;
      const communityName = `E2E Society ${suffix}`;

      // Two published stores, each signed in its own context.
      const joinerCtx = await browser.newContext(CONTEXT_OPTIONS);
      const otherCtx = await browser.newContext(CONTEXT_OPTIONS);
      try {
        const joinerPage = await joinerCtx.newPage();
        const joiner = await registerVendor(request, "community-joiner");
        await signIn(joinerPage, joiner, "/settings/store");
        const joinerSlug = await publishedSlug(joinerPage);

        const otherPage = await otherCtx.newPage();
        const other = await registerVendor(request, "community-other");
        await signIn(otherPage, other, "/settings/store");
        const otherSlug = await publishedSlug(otherPage);

        // Admin makes the page and invites both.
        const admin = await registerVendor(request, "community-admin");
        await setPlatformRole(admin.email, "ADMIN");
        await signIn(page, admin, "/admin/communities");
        await page.getByLabel("Name", { exact: true }).fill(communityName);
        await page.getByLabel("Link", { exact: true }).fill(communitySlug);
        await page.getByRole("button", { name: "Create page" }).click();

        const card = page.getByRole("listitem").filter({ hasText: communityName });
        await expect(card).toBeVisible();
        for (const slug of [joinerSlug, otherSlug]) {
          await card.getByLabel("Invite a store by its link").fill(`http://localhost/s/${slug}`);
          await card.getByRole("button", { name: "Invite" }).click();
          await expect(card.getByRole("status")).toContainText("Invited");
        }
        await expect(card.getByText("Invited", { exact: true })).toHaveCount(2);

        // Nothing is listed before an owner joins.
        const before = await page.goto(`/c/${communitySlug}`);
        expect(before?.status()).toBe(200);
        await expect(page.getByText("No stores listed yet")).toBeVisible();

        // The joiner accepts in Settings → Online store.
        await joinerPage.goto("/settings/store");
        const invite = joinerPage
          .getByRole("region", { name: "Community pages" })
          .getByRole("listitem")
          .filter({ hasText: communityName });
        await invite.getByRole("button", { name: "Join" }).click();
        await expect(invite).toContainText("Your store is listed on this page.");

        // The other store declines; its card goes away.
        await otherPage.goto("/settings/store");
        const otherInvite = otherPage
          .getByRole("region", { name: "Community pages" })
          .getByRole("listitem")
          .filter({ hasText: communityName });
        await otherInvite.getByRole("button", { name: "No thanks" }).click();
        await expect(otherInvite).toHaveCount(0);

        await page.goto(`/c/${communitySlug}`);
        const list = page.getByRole("main").getByRole("list");
        await expect(list.getByRole("link", { name: new RegExp(joiner.stallName) })).toHaveAttribute(
          "href",
          `/s/${joinerSlug}`,
        );
        await expect(page.getByText(other.stallName)).toHaveCount(0);

        // Unpublishing the store takes it off the page without leaving.
        await joinerPage.request.patch("/api/vendor", { data: { publishStorefront: false }, headers: JSON_HEADERS });
        await page.reload();
        await expect(page.getByText(joiner.stallName)).toHaveCount(0);
      } finally {
        await joinerCtx.close();
        await otherCtx.close();
      }
    });
  });
});
