import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn, setDemoFssai } from "../seed/session";
import { fakeSpeech, newDish, priceUpdate, stubParseMenu } from "../stubs/voice";

/**
 * A3 · Speak your menu (docs/DEMO_VIDEOS_PLAN.md, section A).
 *
 * The cook adds three dishes and changes one price by saying them; one dish was
 * said without a price, so they type it; Save adds them to the menu.
 * Speech and parse-menu are stubbed (demo/stubs/voice.ts); /api/menu/bulk is real.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const SPOKEN = "Rajma chawal 160, kadhi pakoda 150, gajar halwa, aur aloo paratha ab 130";

test("A3 speak dishes into the menu", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const paratha = { id: store.ids["Aloo Paratha"]!, name: "Aloo Paratha", rupees: 120, category: "Meals", emoji: "🥙" }; // 🫓 has no glyph in headless Chrome

  await fakeSpeech(page, SPOKEN, { listenMs: 3200 });
  await stubParseMenu(page, {
    items: [
      newDish("Rajma Chawal", 160, "Meals", "🍛"),
      newDish("Kadhi Pakoda", 150, "Meals", "🍲"),
      newDish("Gajar Halwa", 0, "Desserts", "🥕"),
      priceUpdate(paratha, 130),
    ],
    // The row's own "Price needed" badge says it; a warning line would stay after the fix.
    warnings: [],
    unparsed: [],
    model: "haiku",
  });
  await Director.prepare(page);
  await sellerSignIn(page, store, "/menu");
  await setDemoFssai(page);
  const open = page.getByRole("button", { name: "Add dishes by voice" });
  await expect(open).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "a3-speak-your-menu",
    title: "Speak your menu",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("New dishes this week? Don't type them. Say them.");
  await d.tap(open, { after: 600 });
  const panel = page.getByRole("region", { name: "Add dishes by voice" });
  const mic = panel.getByRole("button", { name: "Speak your dishes" });
  await d.say("Tap the mic and read out your dishes with their prices.", { wait: 500 });
  await d.tap(mic, { after: 0 });
  await d.say(`"${SPOKEN}."`, { wait: 600 });

  const heading = panel.getByRole("heading", { name: "Check your dishes" });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  await d.reveal(heading);
  await d.say("Every dish comes back as a row you can check.");
  const rows = panel.getByRole("list", { name: "Dishes heard" });
  const dish = (n: number) => rows.getByRole("group", { name: `Dish ${n}`, exact: true });
  await d.reveal(dish(2));
  await d.beat(800);

  await d.say("Forgot a price? It asks you for it.", { wait: 600 });
  const halwaPrice = dish(3).getByLabel("Price (₹)");
  await d.type(halwaPrice, "90");

  await d.say("Said a new price for an old dish? It updates that one.", { wait: 600 });
  await d.reveal(dish(4).getByText(/Update price/));
  await d.beat(1600);

  await d.say("Save, and they are on your menu.", { wait: 500 });
  await d.tap(panel.getByRole("button", { name: "Add 3, update 1" }), { after: 0 });
  await expect(panel.getByRole("status").filter({ hasText: "Added 3 dishes, updated 1 price" })).toBeVisible({ timeout: 20_000 });
  await d.beat(1200);
  const grid = page.locator("#main-menu");
  await d.reveal(grid.getByText("Rajma Chawal", { exact: true }).first());
  await d.say("Photos and descriptions can come later.");
  await d.stop();
});
