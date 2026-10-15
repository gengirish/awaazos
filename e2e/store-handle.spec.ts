import { expect, test } from "@playwright/test";

import { createVendorSession, E2E_PASSWORD, registerVendor } from "./helpers/vendor";

/**
 * The store link (Vendor.slug) is the owner's to choose: at sign-up, pre-filled
 * from the store name, and later in Settings → Online store → Store link.
 * Writes real rows — throwaway database only (see CLAUDE.md).
 */

function unique(label: string): string {
  return `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test.describe("store link", () => {
  test("sign-up pre-fills the link from the store name and registers with it", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = unique("ember");
    const stallName = `E2E Ember Room ${stamp}`;
    const expectedHandle = `e2e-ember-room-${stamp}`;

    await page.addInitScript(() => {
      window.localStorage.setItem("awz_cookie_pref_v1", "accepted");
    });
    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("E2E Owner");
    await page.getByLabel("Email").fill(`e2e-handle-${stamp}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel("Store name").fill(stallName);

    const handle = page.getByLabel("Store link");
    await expect(handle).toHaveValue(expectedHandle);
    await expect(page.getByText(/^Available\./)).toBeVisible({ timeout: 15_000 });

    // A reserved word is refused on the device, before any request.
    await handle.fill("awaazos");
    await expect(page.getByText("That link is reserved. Try another.")).toBeVisible();
    // Typing keeps the hyphen on the way to a hyphenated handle, and uppercase folds.
    await handle.fill("My Ember-");
    await expect(handle).toHaveValue("my-ember-");
    await handle.fill(expectedHandle);

    await page.getByRole("button", { name: /start|create|sign up|try/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/sign-up"), { timeout: 60_000 });

    const vendor = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
    expect(vendor.vendor.slug).toBe(expectedHandle);

    // The link is now taken: the availability check and a second sign-up both say so.
    const check = (await (await page.request.get(`/api/auth/store-handle?handle=${expectedHandle}`)).json()) as {
      data: { available: boolean; reason?: string };
    };
    expect(check.data.available).toBe(false);
    expect(check.data.reason).toBe("That link is already taken. Try another.");

    const again = await page.request.post("/api/auth/register", {
      data: {
        email: `e2e-handle-again-${stamp}@example.com`,
        password: E2E_PASSWORD,
        name: "E2E Other",
        stallName: "Another store",
        storeHandle: expectedHandle,
        stallType: "STREET_FOOD",
      },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ field: "storeHandle" });
  });

  test("availability check: free, taken, reserved and malformed", async ({ request }) => {
    const free = unique("free-handle");
    const freeRes = (await (await request.get(`/api/auth/store-handle?handle=${free}`)).json()) as {
      data: { available: boolean };
    };
    expect(freeRes.data.available).toBe(true);

    // Register with that handle (API clients send it like the form does); now it is taken.
    const stamp = unique("api");
    const reg = await request.post("/api/auth/register", {
      data: {
        email: `e2e-handle-api-${stamp}@example.com`,
        password: E2E_PASSWORD,
        name: "E2E Api",
        stallName: "API store",
        storeHandle: free.toUpperCase(),
        stallType: "STREET_FOOD",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(reg.status()).toBe(201);
    expect(((await reg.json()) as { vendorSlug: string }).vendorSlug).toBe(free);
    const takenRes = (await (await request.get(`/api/auth/store-handle?handle=${free}`)).json()) as {
      data: { available: boolean };
    };
    expect(takenRes.data.available).toBe(false);

    // Without a handle the register route still falls back to "<name>-<4 chars>".
    await registerVendor(request, "handle-fallback");

    const reserved = (await (await request.get("/api/auth/store-handle?handle=admin")).json()) as {
      data: { available: boolean; reason: string };
    };
    expect(reserved.data).toEqual({ handle: "admin", available: false, reason: "That link is reserved. Try another." });

    const malformed = (await (await request.get("/api/auth/store-handle?handle=Ravi%20s")).json()) as {
      data: { handle: string; available: boolean; reason: string };
    };
    expect(malformed.data.available).toBe(false);
    expect(malformed.data.handle).toBe("ravi s");
  });

  test("settings: the owner changes the link, the old one dies, a taken one is refused", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(180_000);
    await createVendorSession(page, request, "handle-change", "/settings/store");

    const before = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
    const oldSlug = before.vendor.slug;
    const newSlug = unique("e2e-new-link");

    // Publish first so the warning is the "store is live" one and the pages answer.
    const publish = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(publish.status()).toBe(200);

    await page.goto("/settings/store");
    const card = page.getByRole("region", { name: "Store link" });
    const input = card.getByRole("textbox", { name: "Store link" });
    await expect(input).toHaveValue(oldSlug);
    const save = card.getByRole("button", { name: /^(save|saved)$/i });
    const box = await save.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(save).toBeDisabled();

    await input.fill(newSlug);
    await expect(card.getByText("Available.")).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "Save" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`/s/${newSlug}`);
    await expect(dialog).toContainText("Your store is live");
    await dialog.getByRole("button", { name: "Change link" }).click();
    await expect(card.getByRole("button", { name: "Saved" })).toBeVisible();

    const after = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
    expect(after.vendor.slug).toBe(newSlug);

    // The session still resolves this vendor (the awz_vendor cookie moved with the slug).
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Store link" })).toHaveValue(newSlug);

    const live = await page.request.get(`/s/${newSlug}`, { failOnStatusCode: false });
    expect(live.status()).toBe(200);
    const dead = await page.request.get(`/s/${oldSlug}`, { failOnStatusCode: false });
    expect(dead.status()).toBe(404);

    // Another store can't take this link, from settings or at sign-up.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await createVendorSession(otherPage, otherContext.request, "handle-other", "/settings/store");
    const steal = await otherPage.request.patch("/api/vendor", {
      data: { slug: newSlug },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(steal.status()).toBe(409);
    expect(await steal.json()).toEqual({ error: "store_handle_taken" });
    const bad = await otherPage.request.patch("/api/vendor", {
      data: { slug: "ab" },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
    });
    expect(bad.status()).toBe(400);
    await otherContext.close();

    // Saving the current link again is a no-op, not a conflict.
    const same = await page.request.patch("/api/vendor", {
      data: { slug: newSlug },
      headers: { "Content-Type": "application/json" },
    });
    expect(same.status()).toBe(200);
  });
});
