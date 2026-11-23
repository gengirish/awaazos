import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * `DELETE /api/me` (DPDP right to erasure, app/api/me/route.ts): the user goes,
 * and a store where they were the only active OWNER goes with all its data.
 * (The "another OWNER keeps the store" branch needs a second owner, which no
 * API can create yet; it is not covered here.)
 */
test.describe("account deletion", () => {
  test("a sole owner's deletion removes the account and the store, and the session stops working", async ({
    page,
    request,
  }) => {
    const creds = await createVendorSession(page, request, "erase");
    await createMenuItem(page, { name: "Erase Me Samosa", priceInRupees: 15 });
    const store = await openStoreForMenuOrders(page);

    const before = await request.get(`/s/${store.slug}`);
    expect(before.status(), "published store is public before deletion").toBe(200);

    const del = await page.request.delete("/api/me");
    expect(del.status()).toBe(200);
    const body = (await del.json()) as { ok: boolean; deletedVendorIds: string[]; membershipsRemoved: number };
    expect(body.ok).toBe(true);
    expect(body.deletedVendorIds).toEqual([store.id]);
    expect(body.membershipsRemoved).toBe(1);
    // The response names ids only: no email, phone or store name.
    expect(JSON.stringify(body)).not.toContain(creds.email);

    // The store and its catalogue are gone from the public surface.
    expect((await request.get(`/s/${store.slug}`)).status()).toBe(404);

    // The old session cookie no longer reaches a store.
    const vendorApi = await page.request.get("/api/vendor", { failOnStatusCode: false });
    expect([401, 404]).toContain(vendorApi.status());
    const again = await page.request.delete("/api/me");
    expect(again.ok(), "a second delete with the stale session must not succeed").toBe(false);

    // The email is free again: registering it creates a brand-new account.
    const reg = await request.post("/api/auth/register", {
      data: {
        email: creds.email,
        password: E2E_PASSWORD,
        acceptedTerms: true,
        name: "E2E erase again",
        stallName: `${creds.stallName} again`,
        stallType: "STREET_FOOD",
        phone: "+919876543210",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(reg.status()).toBe(201);
  });
});
