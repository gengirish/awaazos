import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * G5 · A free pouch with two pieces (jewellery store, docs/DEMO_VIDEOS_PLAN.md D2).
 *
 * The seller makes the plan in Settings → Offers: two pieces or more, and the velvet
 * pouch is free. The buyer's side (the pouch joining the cart) is in G2.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const POUCH = "Velvet Jewellery Pouch";

test("G5 jewellery seller offers a free pouch with two pieces", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "jewellery", { offer: false });

  await Director.prepare(page);
  await sellerSignIn(page, store, "/settings/offers");
  await expect(page.getByRole("heading", { level: 1, name: "Offers" })).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "g5-free-pouch-offer",
    title: "A free pouch with two pieces",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("Want buyers to take two pieces, not one?");
  await d.say("Add an offer: a free pouch with two pieces or more.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: "New offer" }));
  const form = page.getByRole("dialog", { name: "New offer" });
  await expect(form).toBeVisible();
  await d.type(form.getByLabel("Name"), "Free velvet pouch");
  await d.type(form.getByLabel("Short description (customers see this)"), "Order any 2 pieces, get a pouch free.", { delay: 45 });

  await d.tap(form.getByRole("radio", { name: /^A free item/ }), { after: 500 });
  const minQty = form.getByLabel("Minimum quantity");
  await d.tap(minQty, { after: 200 });
  await minQty.fill("2");
  await d.beat(500);

  await d.say("Pick the gift from your own products.", { wait: 500 });
  const gift = form.getByLabel("Free item", { exact: true });
  await d.tap(gift, { after: 300 });
  // The native picker isn't in the recording.
  await gift.selectOption({ label: POUCH });
  await d.beat(1000);

  await d.say("Save it, and it's live on your store.", { wait: 600 });
  await d.tap(form.getByRole("button", { name: "Create offer" }), { after: 1200 });
  await expect(page.getByRole("switch", { name: "Free velvet pouch active" })).toBeVisible();
  await d.reveal(page.getByRole("switch", { name: "Free velvet pouch active" }), { margin: 200 });
  await d.say("Buyers see it on your store, and the pouch joins their cart by itself.");
  await d.say("Switch it off any time with one tap.");
  await d.stop();
});
