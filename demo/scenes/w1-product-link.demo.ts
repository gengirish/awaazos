import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { quietPhone } from "../seed/session";

/**
 * W1 · A dress from an Instagram post (clothing store; G1 with sizes).
 *
 * The answer to "price pls" and "size available?" in the DMs: the post links straight
 * to the dress (`/s/<slug>/p/<itemId>?src=ig`), which opens with its photo, price,
 * sizes and what's left of each. The buyer picks a size and adds it, then sees the store.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const ANARKALI = "Narayanpet Cotton Anarkali";

test("W1 buyer opens a dress from an Instagram post", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "clothing");

  await quietPhone(page, store.slug);
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "w1-product-link",
    title: "A dress from your post",
    accent: store.accent,
    lang: "en",
  });

  const res = await page.goto(`/s/${store.slug}/p/${store.ids[ANARKALI]}?src=ig`);
  expect(res?.status()).toBe(200);
  const sheet = page.getByRole("dialog", { name: ANARKALI });
  await expect(sheet).toBeVisible();
  await page.waitForLoadState("networkidle");

  await d.start();
  await d.say("A buyer likes a dress in your post and taps the link.");
  await d.say("The dress opens on your store, with its photo and price.", { wait: 900 });
  await d.beat(800);
  await d.say("Nobody has to DM you to ask the price or the sizes.");

  const sizes = sheet.getByRole("group", { name: `${ANARKALI}: size or colour` });
  await d.say("They pick their size, and see when only a few are left.", { wait: 600 });
  await d.reveal(sizes);
  await d.tap(sizes.getByText("M", { exact: true }), { after: 1400 });

  await d.say("One tap adds it to the cart.", { wait: 500 });
  await d.tap(sheet.getByRole("button", { name: `Add ${ANARKALI} – M` }), { after: 1000 });

  await d.say("Close it, and the rest of your collection is right there.", { wait: 700 });
  await d.tap(sheet.getByRole("button", { name: "Close" }), { after: 600 });
  await d.pan(520, 2000);
  await d.stop();
});
