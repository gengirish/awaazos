import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * F5 · Receipts (docs/DEMO_VIDEOS_PLAN.md, section F).
 *
 * After a counter sale the receipt sheet offers WhatsApp. That opens wa.me in
 * the seller's own app, which a recording can't show, so the tap is caught
 * (nothing opens) and the caption says what happens. Then the 58 mm print page
 * and the customer's own receipt page /r/<token>.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("F5 receipts on WhatsApp, on paper and on the customer's phone", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const [thali, curry] = store.everyday;

  await Director.prepare(page);
  await sellerSignIn(page, store, "/pos");
  await expect(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first()).toBeVisible();

  const d = new Director(page, test.info(), {
    scene: "f5-receipts",
    title: "Receipts",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("Every sale gets a proper receipt with its own bill number.", { wait: 600 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${thali}`) }).first(), { after: 400 });
  await d.tap(page.getByRole("button", { name: new RegExp(`^${curry}`) }).first(), { after: 600 });
  await d.tap(page.getByRole("button", { name: "Collect payment" }));
  const dialog = page.getByRole("dialog", { name: "Collect payment" });
  await expect(dialog).toBeVisible();
  await d.tap(dialog.getByRole("button", { name: /Mark as paid/ }), { after: 0 });
  const billText = await page.getByText(/AWZ-\d{8}-\d{4}/).first().textContent({ timeout: 20_000 });
  const bill = billText!.match(/AWZ-\d{8}-\d{4}/)![0];

  const wa = page.getByRole("link", { name: "Send on WhatsApp" });
  await expect(wa).toBeVisible({ timeout: 20_000 });
  // wa.me would leave the filmed page: the tap shows, nothing opens.
  await wa.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await d.say("Send it on WhatsApp from your own number in one tap.", { wait: 400 });
  await d.tap(wa, { after: 1200 });

  // The bill's customer link, read the way the WhatsApp text gets it.
  const list = (await (await page.request.get("/api/transactions?limit=5")).json()) as {
    items: { id: string; billNumber: string }[];
  };
  const tx = list.items.find((i) => i.billNumber === bill);
  expect(tx, "the sale just rung up").toBeTruthy();
  const msg = (await (await page.request.get(`/api/receipts/message?transactionId=${tx!.id}`)).json()) as {
    data: { receiptUrl: string };
  };
  const receiptPath = new URL(msg.data.receiptUrl).pathname;

  await d.say("Need paper? Print it on a 58 millimetre thermal printer.", { wait: 300 });
  await page.goto(`/receipts/${bill}?paper=MM58`);
  const printed = page.getByRole("article", { name: `Receipt ${bill}` });
  await expect(printed).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.beat(2600);

  await d.say("Your customer gets the same receipt as a link on their phone.", { wait: 300 });
  await page.goto(receiptPath);
  await expect(page.getByRole("article", { name: `Receipt ${bill}` })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.beat(1600);
  await d.say("They can save it as a PDF whenever they need it.", { wait: 300 });
  await d.reveal(page.getByRole("button", { name: /print or save as pdf/i }));
  await d.stop();
});
