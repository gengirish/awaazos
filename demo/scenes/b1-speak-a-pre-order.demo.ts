import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn, setDemoFssai } from "../seed/session";
import { fakeSpeech, istYmd, stubParseDrop } from "../stubs/voice";

/**
 * B1 · Speak a pre-order (docs/DEMO_VIDEOS_PLAN.md, section B).
 *
 * The cook says what they will make, the price, the pickup window and the
 * cut-off; the pre-order form fills itself; "Open orders" saves and opens it;
 * the share message is copied for WhatsApp.
 * Speech and parse-drop are stubbed (demo/stubs/voice.ts); saving and opening are real.
 * On screen the product says "pre-order", never "drop".
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const SPOKEN = "Parson 15 veg biryani 200 rupaye, 10 chicken curry, pickup 12:30 se 2:30, order kal raat 9 tak";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("B1 build a pre-order by voice and open it", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const biryani = "Veg Biryani";
  const curry = "Chicken Curry with Rice";
  const day = istYmd(2);

  await fakeSpeech(page, SPOKEN, { listenMs: 3600 });
  await stubParseDrop(page, {
    title: "Biryani day",
    date: day,
    fulfilmentMode: "PICKUP",
    fulfilmentStart: "12:30",
    fulfilmentEnd: "14:30",
    closesAtDate: istYmd(1),
    closesAtTime: "21:00",
    items: [
      { menuItemId: store.ids[biryani], name: biryani, priceInPaise: 20_000, maxQty: 15, perOrderLimit: null, sortOrder: 0 },
      { menuItemId: store.ids[curry], name: curry, priceInPaise: 24_000, maxQty: 10, perOrderLimit: null, sortOrder: 1 },
    ],
    unmatched: [],
    warnings: [],
    filled: ["title", "date", "fulfilmentMode", "fulfilmentStart", "fulfilmentEnd", "closesAtDate", "closesAtTime", "items"],
    model: "haiku",
  });
  await Director.prepare(page);
  await sellerSignIn(page, store, "/drops/new");
  await setDemoFssai(page);
  await expect(page.getByRole("heading", { name: "New pre-order" })).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "b1-speak-a-pre-order",
    title: "Speak a pre-order",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("Cooking something special this week? Take orders before you cook.");
  const panel = page.getByRole("region", { name: "Fill this form by voice" });
  const mic = panel.getByRole("button", { name: "Speak your pre-order" });
  await d.say("Tap the mic and say what you're making, the price and when.", { wait: 500 });
  await d.tap(mic, { after: 0 });
  await d.say(`"${SPOKEN}."`, { wait: 800 });

  await expect(panel.getByText(/^Filled \d+ fields and 2 dishes/)).toBeVisible({ timeout: 20_000 });
  await d.say("The whole form fills itself. Everything it heard is marked.", { wait: 900 });
  await d.reveal(page.getByLabel("From", { exact: true }));
  await d.beat(1400);
  const biryaniRow = page.getByRole("listitem").filter({ hasText: biryani });
  await d.reveal(biryaniRow.getByLabel("How many can you make?"));
  await d.say("How many you can make is set too, so you never take too many orders.");

  await d.say("Check it, then open orders.", { wait: 500 });
  await d.tap(page.getByRole("button", { name: "Open orders" }), { after: 0 });
  await page.waitForURL(/\/drops\/[^/]+\/edit/, { timeout: 120_000 });
  const status = page.getByRole("region", { name: "Status" });
  await expect(status.getByText("Taking orders", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.reveal(status);
  await d.say("It's live on your store. Orders stop by themselves at the cut-off.");

  const copy = page.getByRole("button", { name: "Copy message" });
  await d.say("Copy the message and post it on WhatsApp and Instagram.", { wait: 600 });
  await d.tap(copy, { after: 400 });
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await d.beat(1200);
  await d.stop();
});
