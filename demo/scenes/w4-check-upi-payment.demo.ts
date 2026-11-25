import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { claimPaid, placeMenuOrder, sellerSignIn } from "../seed/session";

/**
 * W4 · Check a UPI payment, clothing store (B4 / G4 in a clothing store).
 *
 * Same beats and lines as G4, so the voice-over timings are already measured:
 * the buyer paid by UPI and sent the reference; the seller taps "Yes, received".
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const ANARKALI = "Narayanpet Cotton Anarkali";
const MIDI = "Kota Checks Tiered Midi";
const DUPATTA = "Mul Cotton Dupatta";

test("W4 clothing seller checks a buyer's UPI payment", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "clothing");
  const [priya, arjun] = BUYERS;

  await placeMenuOrder(request, store, { buyer: arjun, items: [{ name: DUPATTA, qty: 1 }], paymentMethod: "CASH" });
  const order = await placeMenuOrder(request, store, {
    buyer: priya,
    items: [
      { name: ANARKALI, qty: 1, colour: "M" },
      { name: MIDI, qty: 1, colour: "XL" },
    ],
    paymentMethod: "UPI",
  });
  await claimPaid(request, store, order, "412345678901");

  await Director.prepare(page);
  await sellerSignIn(page, store, "/orders");

  const d = new Director(page, test.info(), {
    scene: "w4-check-upi-payment",
    title: "Check a UPI payment",
    accent: store.accent,
    lang: "en",
  });

  const card = page.getByRole("article", { name: new RegExp(priya.name) });
  const question = card.getByText(/reach your UPI app\?/);
  await expect(question).toBeVisible();

  await d.start();
  await d.say("Buyers pay you straight on UPI, so no money passes through us.");
  await d.say("When they say they've paid, the order says Check payment.", { wait: 900 });
  await d.reveal(question, { margin: 140 });
  await d.beat(800);

  await d.say("They sent the UPI reference. Match it in your UPI app.", { wait: 600 });
  await d.reveal(card.getByText("412345678901"), { margin: 200 });
  await d.beat(1800);

  await d.say("It's there? Tap Yes, received.", { wait: 600 });
  await d.tap(card.getByRole("button", { name: "Yes, received" }), { after: 1400 });
  await expect(card.getByRole("button", { name: "Yes, received" })).toHaveCount(0);

  await d.say("The order is paid and accepted in one tap.", { wait: 600 });
  await page.getByRole("tab", { name: /^To pack/ }).waitFor();
  await d.tap(page.getByRole("tab", { name: /^To pack/ }), { after: 1000 });
  await d.reveal(card);
  await d.beat(1000);
  await d.say("Not in your app? Tap Not received, and they're asked for the reference again.");
  await d.stop();
});
