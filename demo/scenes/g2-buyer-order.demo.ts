import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { quietPhone } from "../seed/session";

/**
 * G2 · From Instagram bio to order, jewellery store (docs/DEMO_VIDEOS_PLAN.md C1 G).
 *
 * The buyer opens the store from the bio link, picks jhumkas in a colour, adds a
 * bracelet (the free pouch joins by itself), checks out with a pickup time and
 * lands on the order page. Orders stop living in the DMs.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const JHUMKA = "Oxidised Silver Jhumkas";
const BRACELET = "Evil Eye Beaded Bracelet";

test("G2 buyer orders jewellery from the Instagram bio link", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "jewellery");
  const buyer = BUYERS[2];

  await quietPhone(page, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "g2-buyer-order",
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
  await d.say("Your store opens: every piece, with photos and prices.", { wait: 900 });
  await d.pan(380, 2000);
  await d.beat(500);

  // ── Jhumkas, in a colour ────────────────────────────────────────────────
  await d.say("They tap the jhumkas and pick a colour.", { wait: 800 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${JHUMKA}`) }).first());
  const sheet = page.getByRole("dialog", { name: JHUMKA });
  await expect(sheet).toBeVisible();
  await d.beat(900);
  const colours = sheet.getByRole("group", { name: `${JHUMKA}: size or colour` });
  await d.reveal(colours);
  await d.tap(colours.getByText("Red stone", { exact: true }), { after: 900 });
  await d.tap(sheet.getByRole("button", { name: `Add ${JHUMKA} – Red stone` }), { after: 700 });
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 500 });

  // ── A second piece: the offer adds the pouch ────────────────────────────
  await d.say("Add a second piece, and the free pouch joins by itself.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: `Add ${BRACELET}` }).first());
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
