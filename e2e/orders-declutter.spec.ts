import { expect, test, type Page } from "@playwright/test";

import { boardMenuItem, closeBoardMenu } from "./helpers/board";
import { createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * The orders board's layout: the one banner slot, the Share and "⋯" menus, the
 * status pill and the live sync bar. Writes rows — throwaway DB only (see CLAUDE.md).
 */

const SURVEY_KEY = "awz_owner_survey_prompt_hidden";
const DAY_MS = 24 * 60 * 60 * 1000;

async function storeWithOrder(page: Page, request: Parameters<typeof createVendorSession>[1], name: string) {
  await createVendorSession(page, request, name);
  const item = await createMenuItem(page, { name: "Mysore Bonda", priceInRupees: 65 });
  const { slug } = await openStoreForMenuOrders(page);
  const saved = await page.request.patch("/api/vendor", {
    data: { upiId: "layout@upi" },
    headers: { "Content-Type": "application/json" },
  });
  expect(saved.ok()).toBe(true);
  return { slug, itemId: item.id };
}

async function placeOrder(
  request: Parameters<typeof createVendorSession>[1],
  store: { slug: string; itemId: string },
  paymentMethod: "CASH" | "UPI",
) {
  const res = await request.post(`/api/s/${store.slug}/menu-orders`, {
    data: {
      items: [{ menuItemId: store.itemId, qty: 1 }],
      customerName: "Ravi Kumar",
      customerPhone: "+919848054321",
      fulfilmentType: "PICKUP",
      paymentMethod,
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as { data: { orderToken: string } };
}

async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: "dismissed" }) });
    window.dispatchEvent(event);
  });
}

test.describe("orders board layout", () => {
  test("one banner at a time, in priority order; the survey's Not now lasts 14 days", async ({ page, request }) => {
    test.slow();
    await storeWithOrder(page, request, "layout-banner");
    await page.goto("/orders");

    const fssai = page.getByRole("link", { name: /Add your FSSAI number/ });
    const install = page.getByTestId("install-banner");
    const survey = page.getByRole("complementary", { name: "Owner survey" });
    // A new store has no tagline yet: the one-time store polish nudge comes after the FSSAI reminder.
    const polish = page.getByRole("complementary", { name: "Store check" });

    await expect(fssai).toBeVisible();
    await expect(page.getByText(/^Last checked/)).toBeVisible();
    await offerInstall(page);
    await expect(install).toHaveCount(0);
    await expect(survey).toHaveCount(0);

    await page.getByRole("button", { name: "Dismiss for now" }).click();
    await expect(fssai).toHaveCount(0);
    await expect(polish).toContainText("Your store has no tagline yet");
    await expect(polish.getByRole("link", { name: "Add a tagline" })).toHaveAttribute("href", "/settings/store");
    await polish.getByRole("button", { name: "Got it" }).click();
    await expect(polish).toHaveCount(0);
    await expect(async () => {
      await offerInstall(page);
      await expect(install).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(survey).toHaveCount(0);

    await install.getByRole("button", { name: "Dismiss install tip" }).click();
    await expect(survey).toBeVisible();
    await survey.getByRole("button", { name: "Not now" }).click();
    await expect(survey).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(/^Last checked/)).toBeVisible();
    await expect(survey).toHaveCount(0);

    // Thirteen days on it is still snoozed; a little past fourteen it is back, in a new browser
    // session (it shows once per session, so the one it was dismissed in keeps it away).
    await page.evaluate(([key, at]) => localStorage.setItem(key as string, String(at)), [SURVEY_KEY, Date.now() - 13 * DAY_MS]);
    await page.reload();
    await expect(page.getByText(/^Last checked/)).toBeVisible();
    await expect(survey).toHaveCount(0);
    await page.evaluate(([key, at]) => localStorage.setItem(key as string, String(at)), [SURVEY_KEY, Date.now() - 14 * DAY_MS - 1000]);
    await page.reload();
    await expect(page.getByText(/^Last checked/)).toBeVisible();
    await expect(survey).toHaveCount(0);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(survey).toBeVisible();
    // The polish nudge was dismissed for good: it does not come back with the survey.
    await expect(polish).toHaveCount(0);
  });

  test("Share holds every share action; Order settings is in the overflow menu", async ({ page, request, context }) => {
    test.slow();
    const store = await storeWithOrder(page, request, "layout-share");
    await placeOrder(request, store, "CASH");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/orders");

    // The old header controls are gone, not just moved aside.
    const main = page.locator("#main");
    await expect(main.getByRole("link", { name: "My store", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

    await expect(await boardMenuItem(page, "Share", "Share store link")).toBeVisible();
    await expect(await boardMenuItem(page, "Share", "Instagram story")).toBeVisible();
    const open = await boardMenuItem(page, "Share", "Open store");
    await expect(open).toHaveAttribute("href", `/s/${store.slug}`);
    await expect(open).toHaveAttribute("target", "_blank");

    // Copy keeps the menu open and says so on the item itself.
    await (await boardMenuItem(page, "Share", "Copy link")).click();
    await expect(page.getByRole("menuitem", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/s/${store.slug}`);
    await closeBoardMenu(page);

    // Keyboard: Enter opens, arrows move, Escape closes and returns focus.
    const share = main.getByRole("button", { name: "Share", exact: true });
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Share store link", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: /^(Copy link|Copied)$/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(share).toBeFocused();

    const settings = await boardMenuItem(page, "More actions", "Order settings");
    await expect(settings).toHaveAttribute("href", "/settings/orders");
    await closeBoardMenu(page);
  });

  test("the AI story background stays reachable from Share, when it is switched on", async ({ page, request }) => {
    test.skip(process.env.NEXT_PUBLIC_AI_IMAGES_ENABLED !== "true", "the feature flag is off in this build");
    test.slow();
    await storeWithOrder(page, request, "layout-ai");
    await page.goto("/orders");
    await (await boardMenuItem(page, "Share", "Story with an AI background")).click();
    const dialog = page.getByRole("dialog", { name: "Story with an AI background" });
    await expect(dialog).toBeVisible();
    const box = dialog.getByLabel("Describe the background");
    await box.click();
    await box.pressSequentially("warm light");
    await expect(box).toHaveValue("warm light");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("the status pill pauses and reopens menu orders for the owner", async ({ page, request }) => {
    test.slow();
    const store = await storeWithOrder(page, request, "layout-pause");
    await page.goto("/orders");
    await expect(page.getByText(/^Last checked/)).toBeVisible();

    const pill = page.getByRole("button", { name: "Order status: Taking orders" });
    await pill.click();
    await expect(page.getByRole("menu").getByText("Pickup only")).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Paused" }).click();

    const paused = page.getByRole("button", { name: "Order status: Paused" });
    await expect(paused).toBeVisible();
    const buyer = await request.post(`/api/s/${store.slug}/menu-orders`, {
      data: {
        items: [{ menuItemId: store.itemId, qty: 1 }],
        customerName: "Ravi Kumar",
        customerPhone: "+919848054321",
        fulfilmentType: "PICKUP",
        paymentMethod: "CASH",
      },
    });
    expect(buyer.ok(), "a paused store takes no menu orders").toBe(false);

    // The board refreshes after the pause and can close a menu opened mid-refresh: open it again if so.
    await expect(async () => {
      if (!(await page.getByRole("menu").isVisible())) await paused.click();
      await page.getByRole("menuitemradio", { name: "Taking orders" }).click({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(pill).toBeVisible();
    await placeOrder(request, store, "CASH");
  });

  test("Payment to check stands out only with a claim; the sync bar works", async ({ page, request }) => {
    test.slow();
    const store = await storeWithOrder(page, request, "layout-sync");
    await placeOrder(request, store, "CASH");
    await page.goto("/orders");
    await expect(page.getByText(/^Last checked/)).toBeVisible();

    const tile = page.getByRole("listitem").filter({ hasText: /^Payment to check/ });
    await expect(tile).not.toHaveClass(/border-warning/);

    const { data } = await placeOrder(request, store, "UPI");
    const claim = await request.post(`/api/s/${store.slug}/orders/${data.orderToken}/utr`, { data: {} });
    expect(claim.ok(), await claim.text()).toBe(true);

    // Refresh picks the new orders up; the tile now stands out, and not by colour alone.
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(tile).toHaveClass(/border-warning/);
    await expect(tile.locator("svg")).toBeVisible();

    // Sound toggles from the bar and says so.
    const bar = page.getByRole("group", { name: "Live updates" });
    await bar.getByRole("button", { name: /^Order sounds on/ }).click();
    await expect(bar.getByRole("button", { name: /^Order sounds o/ })).toHaveAttribute("aria-pressed", /true|false/);

    // Alerts: a labelled control until this device is subscribed, whichever browser this is.
    if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      await expect(bar.getByRole("button", { name: /alerts/i })).toBeVisible();
    }

    // The polling note lives behind the info button.
    await expect(page.getByText(/Checks every few minutes/)).toHaveCount(0);
    await bar.getByRole("button", { name: "How new orders are checked" }).click();
    await expect(page.getByRole("dialog").getByText(/new orders|Checks every few minutes/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: "About this list" })).toBeVisible();
  });

  test("search opens from an icon beside the tabs, once there are enough orders", async ({ page, request }) => {
    test.slow();
    const store = await storeWithOrder(page, request, "layout-search");
    for (let i = 0; i < 6; i++) await placeOrder(request, store, "CASH");
    await page.goto("/orders");
    await expect(page.getByText(/^Last checked/)).toBeVisible();

    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Search orders" }).click();
    const box = page.getByRole("searchbox", { name: "Search orders" });
    await expect(box).toBeFocused();
    await box.fill("no such buyer");
    await expect(page.getByText(/No orders match/)).toBeVisible();
    await box.press("Escape");
    await expect(box).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Search orders" })).toBeFocused();
    await expect(page.getByRole("article").first()).toBeVisible();
  });

  test("the first order is in the first viewport, with one banner showing", async ({ page, request }, info) => {
    test.slow();
    test.skip(info.project.name !== "chromium", "the 1280×800 layout check");
    const store = await storeWithOrder(page, request, "layout-fold");
    await placeOrder(request, store, "CASH");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/orders");
    await expect(page.getByRole("link", { name: /Add your FSSAI number/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Needs action/ })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("article").first()).toBeInViewport();
  });
});
