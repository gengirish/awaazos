import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * G6 · Received stock, with what it cost (jewellery store, docs/DEMO_VIDEOS_PLAN.md E3).
 *
 * New chokers came in from the supplier. On Products the seller taps "Received
 * stock", enters how many and the cost of each; the count goes up and the item
 * shows its cost and margin (owners and managers only).
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const CHOKER = "Kundan Choker Set";

test("G6 jewellery seller records received stock and its cost", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "jewellery");

  await Director.prepare(page);
  await sellerSignIn(page, store, "/menu");

  const d = new Director(page, test.info(), {
    scene: "g6-received-stock",
    title: "Received stock",
    accent: store.accent,
    lang: "en",
  });

  const received = page.getByRole("button", { name: `Received stock for ${CHOKER}` });
  await expect(received).toBeVisible();

  await d.start();
  await d.say("New stock in from your supplier?");
  await d.say("Every piece shows how many you have left.", { wait: 700 });
  await d.reveal(received, { margin: 180 });
  await d.beat(1000);

  await d.say("Tap Received stock on the piece.", { wait: 500 });
  await d.tap(received);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Received stock" })).toBeVisible();

  await d.say("Enter how many came in, and what you paid for each.", { wait: 600 });
  await d.type(dialog.getByLabel("How many came in?"), "5");
  await d.type(dialog.getByLabel("Cost of each (₹, optional)"), "520");
  await expect(dialog.getByText("5 for ₹2,600.00 in all.")).toBeVisible();
  await d.beat(1400);

  await d.say("Add it, and your stock goes up.", { wait: 500 });
  await d.tap(dialog.getByRole("button", { name: "Add to stock" }), { after: 1000 });
  await expect(page.getByText("6 in stock", { exact: true })).toBeVisible();
  await d.reveal(page.getByText("6 in stock", { exact: true }), { margin: 200 });
  await d.beat(800);

  await d.say("Your cost and margin show on the piece, for you only.");
  await d.reveal(page.getByText(/Cost ₹520\.00 · Margin/), { margin: 200 });
  await d.stop();
});
