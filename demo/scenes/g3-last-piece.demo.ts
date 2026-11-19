import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { placeMenuOrder, quietPhone } from "../seed/session";

/**
 * G3 · The last piece (jewellery store, docs/DEMO_VIDEOS_PLAN.md E2).
 *
 * One kundan choker is left. The store says "Only 1 left"; another buyer orders it
 * (through the public API, unfilmed); the filmed buyer's page then says "Sold out",
 * and the piece can't be ordered twice. Stock is derived from orders, so nothing
 * has to be counted by hand.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const CHOKER = "Kundan Choker Set";

test("G3 the last piece sells once", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "jewellery");

  await quietPhone(page, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "g3-last-piece",
    title: "The last piece",
    accent: store.accent,
    lang: "en",
  });

  const res = await page.goto(`/s/${store.slug}`);
  expect(res?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const choker = page.getByRole("button", { name: new RegExp(`^${CHOKER}`) }).first();

  await d.start();
  await d.say("One kundan choker left, and two buyers want it.");
  await d.say("Your store shows it: only one left.", { wait: 600 });
  await d.reveal(page.getByText("Only 1 left").first(), { margin: 160 });
  await d.beat(1200);

  await d.say("The first buyer orders it.", { wait: 500 });
  await d.tap(choker);
  const sheet = page.getByRole("dialog", { name: CHOKER });
  await expect(sheet).toBeVisible();
  await d.beat(800);
  // Meanwhile, on someone else's phone.
  await placeMenuOrder(request, store, { buyer: BUYERS[1], items: [{ name: CHOKER, qty: 1 }], paymentMethod: "UPI" });
  await d.beat(1000);
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 300 });

  await d.say("Everyone else now sees Sold out.", { wait: 300 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await d.reveal(page.getByText("Sold out", { exact: true }).first(), { margin: 160 });
  await d.beat(1400);

  await d.say("You never sell the same piece twice.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${CHOKER}`) }).first(), { after: 1600 });
  await d.say("Stock goes down with every order, by itself.");
  await d.stop();
});
