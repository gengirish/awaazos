import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { quietPhone } from "../seed/session";

/**
 * W2 · From Instagram bio to order, clothing store (G2 with sizes).
 *
 * The buyer opens the store from the bio link, picks the anarkali in a size, adds a
 * dupatta (the free potli bag joins by itself), checks out with a pickup time and
 * lands on the order page. Orders stop living in the DMs.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const ANARKALI = "Narayanpet Cotton Anarkali";
const DUPATTA = "Mul Cotton Dupatta";

test("W2 buyer orders clothes from the Instagram bio link", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "clothing");
  const buyer = BUYERS[2];

  await quietPhone(page, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "w2-buyer-order",
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
  await d.say("Your store opens: every outfit, with photos and prices.", { wait: 900 });
  await d.pan(380, 2000);
  await d.beat(500);

  // ── The anarkali, in a size ─────────────────────────────────────────────
  await d.say("They tap the anarkali and pick their size.", { wait: 800 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${ANARKALI}`) }).first());
  const sheet = page.getByRole("dialog", { name: ANARKALI });
  await expect(sheet).toBeVisible();
  await d.beat(900);
  const sizes = sheet.getByRole("group", { name: `${ANARKALI}: size or colour` });
  await d.reveal(sizes);
  await d.tap(sizes.getByText("L", { exact: true }), { after: 900 });
  await d.tap(sheet.getByRole("button", { name: `Add ${ANARKALI} – L` }), { after: 700 });
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 500 });

  // ── A second piece: the offer adds the potli ────────────────────────────
  await d.say("Add a dupatta, and the free potli bag joins by itself.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: `Add ${DUPATTA}` }).first());
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
  await d.say("No more orders lost in your DMs.");
  await d.stop();
});
