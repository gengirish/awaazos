import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * F4 · Works offline (docs/DEMO_VIDEOS_PLAN.md, section F).
 *
 * The counter screen keeps selling with no network: the sale is saved on the
 * phone as "Offline #1" and syncs by itself when the network comes back
 * (on the `online` event, never a timer).
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("F4 counter sales work offline and sync later", async ({ page, context, browser, request }) => {
  const store = await seedStore(browser, request, "meals", { fssai: true });
  const [thali, curry] = store.everyday;

  await Director.prepare(page);
  await sellerSignIn(page, store, "/pos");

  // Unfilmed: the first visit registers /sw.js, the reload caches /pos through it.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.reload();
  await expect
    .poll(() => page.evaluate(async () => Boolean(await caches.match("/pos", { ignoreSearch: true }))), {
      timeout: 30_000,
    })
    .toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first()).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "f4-works-offline",
    title: "Works offline",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("The network drops in the middle of a busy lunch.", { wait: 800 });
  await context.setOffline(true);
  await expect(page.getByText(/Offline\./).first()).toBeVisible({ timeout: 20_000 });
  await d.beat(600);
  await d.say("Your counter screen says so, and keeps working.", { wait: 1200 });

  await d.say("Tap the order in as usual.", { wait: 400 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first(), { after: 500 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${curry}`) }).first(), { after: 800 });
  await d.tap(page.getByRole("button", { name: "Collect payment" }));
  const dialog = page.getByRole("dialog", { name: "Collect payment" });
  await expect(dialog).toBeVisible();
  await d.tap(dialog.getByRole("radio", { name: "Cash" }), { after: 500 });
  await d.tap(dialog.getByRole("button", { name: /Mark as paid/ }), { after: 0 });

  await expect(page.getByText("Offline #1").first()).toBeVisible({ timeout: 20_000 });
  await d.say("The sale is saved on your phone as Offline number one.", { wait: 1400 });
  await d.tap(page.getByRole("button", { name: /New order/ }), { after: 600 });
  // The queue line sits at the top of the screen: bring it into view.
  const waiting = page.getByText(/sale waiting to sync/).first();
  await expect(waiting).toBeVisible();
  await d.pan(-(await page.evaluate(() => window.scrollY)), 900);
  await d.say("It waits there safely until the network is back.", { wait: 1200 });

  await context.setOffline(false);
  await d.say("Back online, it syncs by itself.", { wait: 300 });
  await expect(page.getByText(/sales? waiting to sync/)).toHaveCount(0, { timeout: 30_000 });
  await d.beat(1200);

  // The counter's own "Today" figure only refreshes on the next load, so the
  // proof is the bill list: the sale now has a real bill number.
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  await expect(page.getByText(/AWZ-\d{8}-\d{4}/).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.say("Your sale is in your bills with its own bill number.", { wait: 1400 });
  await d.say("No sale is lost, and none is counted twice.");
  await d.stop();
});
