import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { placeMenuOrder, sellerSignIn } from "../seed/session";

/**
 * B3 · The orders board, one order start to finish (docs/DEMO_VIDEOS_PLAN.md).
 *
 * Three buyers have ordered (through the public API, unfilmed). The seller opens
 * /orders on their phone and walks one order through To accept → To make → To hand over →
 * Done, collecting the cash at pickup.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("B3 seller works one order across the board", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals", { fssai: true });
  const [thali, curry] = store.everyday;
  const [priya, arjun, meera] = BUYERS;

  await placeMenuOrder(request, store, { buyer: priya, items: [{ name: thali, qty: 2 }], paymentMethod: "CASH" });
  await placeMenuOrder(request, store, { buyer: arjun, items: [{ name: curry, qty: 1 }], delivery: true, paymentMethod: "CASH" });
  await placeMenuOrder(request, store, { buyer: meera, items: [{ name: thali, qty: 1 }, { name: curry, qty: 1 }], paymentMethod: "CASH" });

  await Director.prepare(page);
  await sellerSignIn(page, store, "/orders");
  await expect(page.getByRole("tab", { name: /^To accept/ })).toHaveAttribute("aria-selected", "true");

  const d = new Director(page, test.info(), {
    scene: "b3-orders-board",
    title: "Your orders board",
    accent: store.accent,
    lang: "en",
  });

  const card = page.getByRole("article", { name: new RegExp(priya.name) });
  const tab = (name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

  await d.start();
  await d.say("Every order lands on one board, on your phone.");
  await d.say("Orders to accept wait at the top, with what to cook and when.", { wait: 900 });
  await d.pan(260, 1600);
  await d.beat(500);
  await d.reveal(card);
  await d.beat(600);

  await d.say("Accept an order and it moves to To make.", { wait: 600 });
  await d.tap(card.getByRole("button", { name: "Accept order" }), { after: 1200 });
  await d.tap(tab("To make"), { after: 900 });
  await expect(card).toBeVisible();

  await d.say("Food's packed? Mark it ready, and it moves to To hand over.", { wait: 600 });
  await d.tap(card.getByRole("button", { name: "Mark ready" }), { after: 1200 });
  await d.tap(tab("To hand over"), { after: 900 });
  await expect(card).toBeVisible();

  await d.say("When they pick it up, one tap books the cash.", { wait: 600 });
  await d.tap(card.getByRole("button", { name: /^Mark picked up/ }), { after: 1200 });
  await d.tap(tab("Done"), { after: 900 });
  await expect(card).toBeVisible();
  await d.beat(800);

  await d.say("The line at the top keeps count of what's paid and what's left to collect.", { wait: 600 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await d.beat(1600);
  await d.say("Two more orders are waiting under To accept.");
  await d.tap(tab("To accept"), { after: 1200 });
  await d.stop();
});
