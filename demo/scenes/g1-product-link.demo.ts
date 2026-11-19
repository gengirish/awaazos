import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { quietPhone } from "../seed/session";

/**
 * G1 · A piece from an Instagram post (jewellery store, docs/DEMO_VIDEOS_PLAN.md A6/C1 G).
 *
 * The answer to "price pls" in the DMs: the post links straight to the piece
 * (`/s/<slug>/p/<itemId>?src=ig`), which opens with its photo, price, colours and
 * what's left of each. The buyer picks a colour and adds it, then sees the store.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const PEARL = "Pearl Drop Earrings";

test("G1 buyer opens a piece from an Instagram post", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "jewellery");

  await quietPhone(page, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "g1-product-link",
    title: "A piece from your post",
    accent: store.accent,
    lang: "en",
  });

  const res = await page.goto(`/s/${store.slug}/p/${store.ids[PEARL]}?src=ig`);
  expect(res?.status()).toBe(200);
  const sheet = page.getByRole("dialog", { name: PEARL });
  await expect(sheet).toBeVisible();
  await page.waitForLoadState("networkidle");

  await d.start();
  await d.say("A buyer likes your earrings in a post and taps the link.");
  await d.say("The piece opens on your store, with its photo and price.", { wait: 900 });
  await d.beat(800);
  await d.say("Nobody has to DM you to ask the price.");

  const colours = sheet.getByRole("group", { name: `${PEARL}: size or colour` });
  await d.say("They pick a colour, and see when only a few are left.", { wait: 600 });
  await d.reveal(colours);
  await d.tap(colours.getByText("Pink", { exact: true }), { after: 1400 });

  await d.say("One tap adds it to the cart.", { wait: 500 });
  await d.tap(sheet.getByRole("button", { name: `Add ${PEARL} – Pink` }), { after: 1000 });

  await d.say("Close it, and the rest of your collection is right there.", { wait: 700 });
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 600 });
  await d.pan(520, 2000);
  await d.stop();
});
