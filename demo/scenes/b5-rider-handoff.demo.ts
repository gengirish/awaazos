import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { BUYERS } from "../seed/cast";
import { seedStore } from "../seed/kitchen";
import { placeMenuOrder, sellerSignIn } from "../seed/session";

/**
 * B5 · Hand over to a rider (docs/DEMO_VIDEOS_PLAN.md).
 *
 * A pay-on-delivery order and a saved rider ("Ravi", made up). The seller taps
 * "Send to Ravi": the wa.me link is answered locally (WhatsApp never opens on the
 * recording machine), the order goes out for delivery, and the scene then opens
 * the rider's own /d/<token> link on the same phone and taps Delivered, which
 * books the cash.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

const RIDER = { name: "Ravi", phone: "9199999021" };

test("B5 seller hands a delivery to a rider", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals", { fssai: true });
  const [thali, curry] = store.everyday;
  const [, arjun] = BUYERS;

  await placeMenuOrder(request, store, {
    buyer: arjun,
    items: [{ name: curry, qty: 1 }, { name: thali, qty: 1 }],
    delivery: true,
    paymentMethod: "CASH",
  });

  // The wa.me tab never leaves the machine. A page, not a 204: a popup whose first
  // load never commits holds the tap (and the camera) for ~12 s.
  await page.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
  await Director.prepare(page);
  await sellerSignIn(page, store, "/orders");
  const riders = await page.request.patch("/api/vendor", {
    data: { deliveryRiders: [RIDER] },
    headers: { "Content-Type": "application/json" },
  });
  expect(riders.ok(), "save the rider").toBe(true);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const card = page.getByRole("article", { name: new RegExp(arjun.name) });
  // Accepted already, unfilmed: this scene starts at the handover.
  await card.getByRole("button", { name: "Accept order" }).click();
  await page.getByRole("tab", { name: /^To make/ }).click();
  // Collapsed on To make: open it so the rider buttons show.
  await card.getByRole("button", { name: /Show details/ }).click();
  const send = card.getByRole("link", { name: new RegExp(`to ${RIDER.name} on WhatsApp`) });
  await expect(send).toBeVisible();
  const text = decodeURIComponent(((await send.getAttribute("href")) ?? "").split("?text=")[1] ?? "");
  const riderPath = new URL(/When delivered, tap: (\S+)$/.exec(text)?.[1] ?? "http://x/").pathname;
  expect(riderPath).toMatch(/^\/d\//);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let the unfilmed accept's toast go before the camera rolls.
  await expect(page.getByText(/Order accepted/)).toHaveCount(0, { timeout: 20_000 });

  const d = new Director(page, test.info(), {
    scene: "b5-rider-handoff",
    title: "Hand over to a rider",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("A delivery order is cooked and packed.");
  await d.reveal(card, { margin: 60 });
  await d.say(`Save your riders once, and each order gets a Send to ${RIDER.name} button.`, { wait: 800 });
  await d.reveal(send, { margin: 140 });
  await d.beat(800);

  await d.say("One tap sends the address, the items and the cash to collect on WhatsApp.", { wait: 700 });
  const popup = page.context().waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await d.tap(send, { after: 600 });
  await (await popup)?.close();
  await page.bringToFront();
  await d.beat(800);

  await d.say("The order moves to To hand over, on the way with your rider.", { wait: 600 });
  await d.tap(page.getByRole("tab", { name: /^To hand over/ }), { after: 600 });
  await expect(card).toContainText(`On the way with ${RIDER.name}`);
  await d.reveal(card);
  await d.beat(1200);

  // ── The rider's phone: their own link from the message ─────────────────
  await d.say("The message ends with the rider's own link.");
  await page.goto(riderPath);
  await expect(page.getByRole("heading", { level: 1, name: arjun.name })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.beat(600);
  await d.say("It shows the door, the phone number and the cash to collect.", { wait: 900 });
  await d.pan(220, 1400);
  await d.beat(600);

  await d.say("At the door, the rider taps Delivered.", { wait: 600 });
  const delivered = page.getByRole("button", { name: /^Delivered · ₹[\d,.]+ collected$/ });
  await d.tap(delivered.first(), { after: 900 });
  await d.tap(page.getByRole("dialog", { name: "Handed it over?" }).getByRole("button", { name: /^Delivered/ }), { after: 1000 });
  await expect(page.getByRole("heading", { name: "Delivered" })).toBeVisible();

  await d.say("Done: the cash is booked, and the buyer's details leave the rider's phone.");
  await d.stop();
});
