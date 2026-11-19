import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";

/**
 * C1 · From Instagram bio to order (docs/DEMO_VIDEOS_PLAN.md, the Phase 0 pilot).
 *
 * A buyer opens a home kitchen's store from its Instagram bio link, looks at a
 * dish, adds two meals (the free lassi joins by itself), picks a pickup time,
 * places the order and lands on the order page with UPI pay.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("C1 buyer orders from the Instagram bio link", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const [thali, curry] = store.everyday;
  const buyer = BUYERS[0];

  // A buyer's phone: no cookie banner, no "add to Home Screen" card in the way of the menu.
  await page.addInitScript((slug: string) => {
    try {
      localStorage.setItem("awz_cookie_pref_v1", "accepted");
      localStorage.setItem("awz_install_hint_dismissed_v1", "1");
      // storeInstallDismissKey() in lib/store-app.ts
      localStorage.setItem(`awz_store_install_dismissed_v1:${slug}`, "1");
    } catch {}
  }, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "c1-buyer-order",
    title: "From Instagram bio to order",
    accent: store.accent,
    lang: "en",
  });

  const res = await page.goto(`/s/${store.slug}?src=ig`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await d.start();
  await d.say("Your buyer taps the link in your Instagram bio.");
  await d.say("Your own store opens: your menu, photos and prices.", { wait: 900 });
  await d.pan(420, 2200);
  await d.beat(600);

  // ── A closer look at one dish ───────────────────────────────────────────
  await d.say("They tap a dish to see it up close.", { wait: 800 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first());
  const sheet = page.getByRole("dialog", { name: thali });
  await expect(sheet).toBeVisible();
  await d.beat(1400);
  await d.tap(sheet.getByRole("button", { name: `Add ${thali}` }));
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 500 });

  // ── A second meal: the offer adds the gift ──────────────────────────────
  await d.say("Add a second meal and the free lassi joins the order by itself.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: `Add ${curry}` }));
  await d.beat(1600);

  // ── Checkout ────────────────────────────────────────────────────────────
  await d.say("Checkout takes a few seconds.", { wait: 500 });
  await d.tap(page.getByRole("button", { name: "Checkout" }).first());
  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await expect(checkout).toBeVisible();
  await d.beat(1200);

  await d.say("They pick pickup or delivery, and a time that suits you.", { wait: 600 });
  const pickup = checkout.getByRole("radio", { name: "Pickup" });
  if (await pickup.count()) await d.tap(pickup);
  const when = checkout.getByLabel(/pick up when\?/i);
  await d.tap(when, { after: 300 });
  // The native picker isn't in the recording; choose the first open slot.
  const firstSlot = await when.locator("option:not([disabled])").first().getAttribute("value");
  await when.selectOption(firstSlot ?? "");
  await d.beat(900);

  await d.type(checkout.getByLabel("Your name"), buyer.name);
  await d.type(checkout.getByLabel("Mobile number"), buyer.mobile);
  await d.beat(500);

  await d.say("One tap and the order is yours.", { wait: 400 });
  await d.tap(checkout.getByRole("button", { name: /place order/i }), { after: 0 });

  // ── The buyer's order page ──────────────────────────────────────────────
  await page.waitForURL(new RegExp(`/s/${store.slug}/o/[^/]+$`), { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.say("They pay you straight on UPI. No commission.");
  await d.pan(260, 1400);
  // The seller's side (the board picking it up) is scene C6, split-screen, in Phase 1.
  await d.say("Their order page shows every step until it's ready.");
  await d.stop();
});
