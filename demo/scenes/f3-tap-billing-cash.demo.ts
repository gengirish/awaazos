import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * F3 · Tap billing, cash and change (docs/DEMO_VIDEOS_PLAN.md, section F).
 *
 * The seller rings up a counter sale by tapping tiles, takes a note in cash,
 * sees the change to return, marks it paid and gets a bill number, then
 * undoes it within the 5 s window.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("F3 tap billing with cash and change", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals", { fssai: true });
  const [thali, curry] = store.everyday;

  await Director.prepare(page);
  await sellerSignIn(page, store, "/pos");
  await expect(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first()).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "f3-tap-billing-cash",
    title: "Tap billing, cash and change",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("A customer at your door? Ring them up on the counter screen.", { wait: 1200 });

  await d.say("Tap a dish once for each plate.", { wait: 500 });
  const thaliTile = page.getByRole("button", { name: new RegExp(`^${thali}`) }).first();
  await d.tap(thaliTile, { after: 500 });
  await d.tap(thaliTile, { after: 500 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${curry}`) }).first(), { after: 900 });

  await d.say("The bill adds itself up as you go.", { wait: 900 });
  await d.tap(page.getByRole("button", { name: "Collect payment" }));
  const dialog = page.getByRole("dialog", { name: "Collect payment" });
  await expect(dialog).toBeVisible();

  await d.say("They pay cash, so switch to Cash.", { wait: 500 });
  await d.tap(dialog.getByRole("radio", { name: "Cash" }), { after: 800 });

  await d.say("Tap the note they hand you, and see the change to give back.", { wait: 500 });
  // The first note above the total (Exact is the button before it).
  await d.tap(dialog.getByRole("button", { name: /^₹[\d,]+$/ }).first(), { after: 300 });
  await expect(dialog).toContainText("Change to return");
  await d.beat(1600);

  await d.say("Mark it paid and the bill number is ready.", { wait: 400 });
  await d.tap(dialog.getByRole("button", { name: /Mark as paid/ }), { after: 0 });
  await expect(page.getByText(/AWZ-\d{8}-\d{4}/).first()).toBeVisible({ timeout: 20_000 });
  await d.beat(1600);

  await d.say("Tapped by mistake? Undo it within five seconds.", { wait: 300 });
  await d.tap(page.getByRole("button", { name: "Undo payment" }), { after: 0 });
  await expect(page.getByText("Payment undone")).toBeVisible({ timeout: 20_000 });
  await d.beat(800);

  await d.say("The order comes back, ready to fix and charge again.");
  await d.stop();
});
