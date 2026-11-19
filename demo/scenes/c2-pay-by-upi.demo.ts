import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { placeMenuOrder, quietPhone } from "../seed/session";

/**
 * C2 · Pay by UPI (docs/DEMO_VIDEOS_PLAN.md, section C).
 *
 * The order is placed off camera (C1 films that part). The buyer is on the order
 * page: one button opens their UPI app with the amount filled in, then "Payment
 * done" tells the seller to check. The UPI app itself can't be filmed, so the
 * tap on the upi:// link is stopped in the page and the caption says what opens.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("C2 buyer pays by UPI from the order page", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const [thali, curry] = store.everyday;
  const order = await placeMenuOrder(request, store, {
    buyer: BUYERS[1],
    items: [
      { name: thali, qty: 1 },
      { name: curry, qty: 1 },
    ],
    paymentMethod: "UPI",
  });

  await quietPhone(page, store.slug);
  // A headless browser has no UPI app: keep the tap from leaving the page.
  await page.addInitScript(() => {
    document.addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest?.("a[href]");
        const href = a?.getAttribute("href") ?? "";
        if (/^(upi|tez|phonepe|paytmmp):/i.test(href)) e.preventDefault();
      },
      true,
    );
  });
  await Director.prepare(page);

  const d = new Director(page, test.info(), {
    scene: "c2-pay-by-upi",
    title: "Pay by UPI",
    accent: store.accent,
    lang: "en",
  });

  const res = await page.goto(`/s/${store.slug}/o/${order.orderToken}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
  const payLink = page.getByRole("link", { name: /^Pay ₹[\d,.]+ with a UPI app$/ });
  await expect(payLink).toBeVisible();
  await page.waitForLoadState("networkidle");

  await d.start();
  await d.say("Your buyer's order is in. Now they pay you.");
  await d.say("The amount and your UPI ID are already on the page.", { wait: 900 });
  await d.reveal(payLink);
  await d.beat(800);

  await d.say("One tap opens their UPI app with the amount filled in.", { wait: 700 });
  await d.tap(payLink, { after: 1600 });

  await d.say("The money goes straight to your bank. No commission.");

  const paid = page.getByRole("button", { name: "Payment done" });
  await d.say("Back here, they tap Payment done.", { wait: 600 });
  await d.tap(paid, { after: 0 });
  const submitted = page.getByRole("heading", { name: /payment submitted/i });
  await expect(submitted).toBeVisible();
  await d.reveal(submitted);
  await d.beat(600);

  await d.say("You check your UPI app, then confirm with one tap.");
  await d.say("Their order page waits for your yes.");
  await d.stop();
});
