import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn, setDemoFssai } from "../seed/session";
import { fakeSpeech, stubParseOrder } from "../stubs/voice";

/**
 * F1 · Bill by voice (docs/DEMO_VIDEOS_PLAN.md, section F).
 *
 * At the counter the cook taps the mic and says the order in Hinglish; the cart
 * fills, the UPI QR shows the total, "Mark as paid" gives a bill number.
 * Speech and parse-order are stubbed (demo/stubs/voice.ts): no paid call.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const SPOKEN = "Ek veg thali aur do sweet lassi";

test("F1 bill a counter sale by voice", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const thali = store.everyday[0]!; // Veg Thali, ₹180
  const lassi = store.gift; // Sweet Lassi, ₹50

  await fakeSpeech(page, SPOKEN);
  await stubParseOrder(page, [
    { menuItemId: store.ids[thali]!, name: thali, priceInPaise: 18_000, qty: 1 },
    { menuItemId: store.ids[lassi]!, name: lassi, priceInPaise: 5_000, qty: 2 },
  ]);
  await Director.prepare(page);
  await sellerSignIn(page, store, "/pos");
  await setDemoFssai(page);
  const mic = page.getByRole("button", { name: "Start voice order" });
  await expect(mic).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "f1-bill-by-voice",
    title: "Bill by voice",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("A customer at your counter? Just say the order.");
  await d.say("Tap the mic and speak, in Hindi or English.", { wait: 600 });
  await d.tap(mic, { after: 0 });
  await d.say(`"${SPOKEN}."`, { wait: 400 });

  const cart = page.getByRole("region", { name: "Cart" });
  await expect(cart).toContainText(thali, { timeout: 20_000 });
  await expect(cart).toContainText("₹280.00");
  await d.say("The bill is ready before you put the phone down.");
  // The cart, each line marked "Voice", is under the quick-add grid.
  await d.pan(600, 1600);
  await d.beat(1600);
  await d.pan(-600, 1000);

  await d.say("Collect the payment.", { wait: 500 });
  await d.tap(page.getByRole("button", { name: "Collect payment" }));
  const pay = page.getByRole("dialog");
  const upi = pay.getByRole("radio", { name: "UPI QR" });
  if ((await upi.count()) && !(await upi.isChecked())) await d.tap(upi);
  await expect(pay.getByRole("img", { name: /UPI payment QR code/i })).toBeVisible();
  await d.say("Your UPI QR shows the exact amount. The customer scans and pays you.");

  await d.say("Once the money is in, mark it paid.", { wait: 500 });
  await d.tap(pay.getByRole("button", { name: /Mark as paid/ }), { after: 0 });
  await expect(page.getByText(/AWZ-\d{8}-\d{4}/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Paid ₹280\.00 via UPI/)).toBeVisible();
  await d.say("Every sale gets a bill number, ready to send on WhatsApp.");
  await d.stop();
});
