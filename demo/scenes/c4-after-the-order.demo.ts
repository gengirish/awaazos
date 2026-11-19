import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, signIn } from "../../e2e/helpers/vendor";
import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { placeMenuOrder, quietPhone } from "../seed/session";

/**
 * C4 · After the order (docs/DEMO_VIDEOS_PLAN.md, section C).
 *
 * A paid delivery order, followed on the buyer's order page: the seller (off
 * camera, through the board's own routes) sends it out, the buyer checks for an
 * update, says it arrived, rates it and orders again.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

async function sellerAction(seller: Page, orderId: string, action: string): Promise<void> {
  const res = await seller.request.patch(`/api/storefront-orders/${orderId}`, { data: { action }, headers: JSON_HEADERS });
  expect(res.status(), `${action}: ${await res.text()}`).toBe(200);
}

test("C4 buyer follows the order, says it arrived, rates it and orders again", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  const [thali, curry] = store.everyday;
  const buyer = BUYERS[2];
  const order = await placeMenuOrder(request, store, {
    buyer,
    items: [
      { name: thali, qty: 1 },
      { name: curry, qty: 1 },
    ],
    delivery: true,
    paymentMethod: "UPI",
  });

  // The seller's phone, never filmed: it moves the order along.
  const sellerCtx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const seller = await sellerCtx.newPage();
    await signIn(seller, { email: store.email, password: store.password, stallName: store.name }, "/orders");
    const board = (await (await seller.request.get("/api/storefront-orders")).json()) as {
      data: { id: string; billNumber: string }[];
    };
    const orderId = board.data.find((o) => o.billNumber === order.billNumber)?.id;
    expect(orderId, "the order on the seller's board").toBeTruthy();
    // The seller saw the money arrive: paid, and with it confirmed.
    await sellerAction(seller, orderId!, "mark_paid");

    await quietPhone(page, store.slug);
    await Director.prepare(page);
    const d = new Director(page, test.info(), {
      scene: "c4-after-the-order",
      title: "After the order",
      accent: store.accent,
      lang: "en",
    });

    const res = await page.goto(`/s/${store.slug}/o/${order.orderToken}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    await d.start();
    await d.say("Your buyer keeps their order page open.");
    await d.say("It shows every step, so they never need to call you.", { wait: 900 });
    await d.pan(200, 1200);
    await d.beat(800);

    // ── The seller sends it out (off camera) ────────────────────────────
    await sellerAction(seller, orderId!, "dispatch");
    await d.say("When you send it out, one tap shows them the news.", { wait: 600 });
    await d.pan(-200, 900);
    await d.tap(page.getByRole("button", { name: "Check for update" }), { after: 1400 });
    await expect(page.getByText(/on the way/i).first()).toBeVisible();

    // ── It arrived ──────────────────────────────────────────────────────
    const received = page.getByRole("button", { name: "I've received my order" });
    await d.say("When it arrives, they tell you with one tap.", { wait: 600 });
    await d.tap(received, { after: 1200 });
    // A paid order is delivered by the buyer's tap: the page says so.
    await expect(page.getByRole("heading", { name: "Delivered" })).toBeVisible();

    // ── Stars and a comment ─────────────────────────────────────────────
    const feedback = page.getByRole("heading", { name: "How was your order?" });
    await expect(feedback).toBeVisible();
    await d.reveal(feedback);
    await d.say("Then they rate it. You read every word.", { wait: 600 });
    await d.tap(page.getByRole("radio", { name: /^5 out of 5/ }), { after: 500 });
    await d.type(page.getByLabel(/anything to add/i), "Tasted just like home. Thank you!");
    await d.tap(page.getByRole("button", { name: "Send feedback" }), { after: 0 });
    await expect(page.getByText(/You rated this 5 of 5/)).toBeVisible();
    await d.beat(1200);

    // ── Order again ─────────────────────────────────────────────────────
    const again = page.getByRole("button", { name: `Order again: ${order.billNumber}` });
    await d.say("Next time, Order again fills the cart in one tap.", { wait: 600 });
    await d.tap(again, { after: 0 });
    await page.waitForURL(new RegExp(`/s/${store.slug}#menu-order$`));
    await page.waitForLoadState("networkidle");
    await d.beat(800);
    await d.tap(page.getByRole("button", { name: "Checkout" }).first(), { after: 0 });
    const checkout = page.getByRole("dialog", { name: "Checkout" });
    await expect(checkout.getByRole("list", { name: "Items in your cart" }).getByText(thali)).toBeVisible();
    await d.beat(600);
    await d.say("Same dishes, same address. Happy buyers come back.");
    await d.stop();
  } finally {
    await sellerCtx.close();
  }
});
