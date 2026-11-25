import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * W6 · Received stock, with what it cost (clothing store; G6).
 *
 * New dupattas came in from the weaver. On Products the seller taps "Received
 * stock", enters how many and the cost of each; the count goes up and the item
 * shows its cost and margin (owners and managers only).
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const DUPATTA = "Mul Cotton Dupatta";

test("W6 clothing seller records received stock and its cost", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "clothing");

  await Director.prepare(page);
  await sellerSignIn(page, store, "/menu");

  const d = new Director(page, test.info(), {
    scene: "w6-received-stock",
    title: "Received stock",
    accent: store.accent,
    lang: "en",
  });

  const received = page.getByRole("button", { name: `Received stock for ${DUPATTA}` });
  await expect(received).toBeVisible();

  await d.start();
  await d.say("New stock in from your weaver?");
  await d.say("Every product shows how many you have left.", { wait: 700 });
  await d.reveal(received, { margin: 180 });
  await d.beat(1000);

  await d.say("Tap Received stock on the product.", { wait: 500 });
  await d.tap(received);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Received stock" })).toBeVisible();

  await d.say("Enter how many came in, and what you paid for each.", { wait: 600 });
  await d.type(dialog.getByLabel("How many came in?"), "10");
  await d.type(dialog.getByLabel("Cost of each (₹, optional)"), "280");
  await expect(dialog.getByText("10 for ₹2,800.00 in all.")).toBeVisible();
  await d.beat(1400);

  await d.say("Add it, and your stock goes up.", { wait: 500 });
  await d.tap(dialog.getByRole("button", { name: "Add to stock" }), { after: 1000 });
  await expect(page.getByText("15 in stock", { exact: true })).toBeVisible();
  await d.reveal(page.getByText("15 in stock", { exact: true }), { margin: 200 });
  await d.beat(800);

  await d.say("Your cost and margin show on the product, for you only.");
  await d.reveal(page.getByText(/Cost ₹280\.00 · Margin/), { margin: 200 });
  await d.stop();
});
