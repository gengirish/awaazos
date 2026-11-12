import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CAN_SET_BILLING, markPaidOnlineByOrderId } from "./helpers/billing-db";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * "I've received my order" (POST /api/s/[slug]/orders/[token]/received,
 * lib/rider-delivery.ts). The buyer's tap tells the seller a confirmed delivery
 * arrived. A paid order is then marked delivered; an unpaid one only carries
 * the note, because a buyer's tap never books cash: the seller still confirms it.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

type BoardOrder = { id: string; customerName: string | null; paymentStatus: string; fulfilmentStatus: string };

/** A store taking delivery and pickup orders from its menu, paid on delivery. */
async function deliveryStore(page: Page): Promise<{ slug: string; itemId: string }> {
  const item = await createMenuItem(page, { name: "Ragi Laddu", priceInRupees: 150, category: "Sweets" });
  const res = await page.request.patch("/api/vendor", {
    data: { publishStorefront: true, acceptPayOnDelivery: true, menuFulfilmentMode: "BOTH" },
    headers: JSON_HEADERS,
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: true } })).status()).toBe(200);
  const { vendor } = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
  return { slug: vendor.slug, itemId: item.id };
}

async function placeOrder(
  request: APIRequestContext,
  slug: string,
  itemId: string,
  buyer: string,
  fulfilmentType: "DELIVERY" | "PICKUP",
): Promise<string> {
  const res = await request.post(`/api/s/${slug}/menu-orders`, {
    data: {
      items: [{ menuItemId: itemId, qty: 2 }],
      customerName: buyer,
      customerPhone: "+919848054321",
      fulfilmentType,
      ...(fulfilmentType === "DELIVERY" ? { deliveryAddress: "12 Lake Road", deliveryLocality: "Yelahanka" } : {}),
      paymentMethod: "CASH",
    },
    headers: JSON_HEADERS,
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { orderToken: string } }).data.orderToken;
}

async function boardOrder(page: Page, buyer: string): Promise<BoardOrder> {
  const list = (await (await page.request.get("/api/storefront-orders")).json()) as { data: BoardOrder[] };
  const order = list.data.find((o) => o.customerName === buyer);
  expect(order, `${buyer}'s order on the board`).toBeTruthy();
  return order!;
}

async function confirm(page: Page, orderId: string): Promise<void> {
  const res = await page.request.patch(`/api/storefront-orders/${orderId}`, {
    data: { action: "confirm" },
    headers: JSON_HEADERS,
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe("buyer says the order arrived", () => {
  test("an unpaid delivery: the seller sees the note and still confirms the cash", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(180_000);
    await createVendorSession(page, request, "received", "/orders");
    const { slug, itemId } = await deliveryStore(page);
    const token = await placeOrder(request, slug, itemId, "Asha Received", "DELIVERY");
    const orderPath = `/s/${slug}/o/${token}`;

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      const received = buyer.getByRole("button", { name: "I've received my order" });

      // The page offers it once the seller has confirmed the order. (The route takes a
      // placed one too, and the board shows the note on either, but nobody is asked early.)
      await buyer.goto(orderPath);
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      await expect(received).toHaveCount(0);

      await confirm(page, (await boardOrder(page, "Asha Received")).id);

      await buyer.reload();
      await received.click();
      await expect(buyer.getByRole("status").filter({ hasText: "the store knows you got it" })).toBeVisible();
      await expect(received).toHaveCount(0);
    } finally {
      await buyerCtx.close();
    }

    // Once only.
    const again = await request.post(`/api/s/${slug}/orders/${token}/received`);
    expect(again.status()).toBe(409);

    // The tap booked no cash: still unpaid and confirmed, with the note on the card.
    expect(await boardOrder(page, "Asha Received")).toMatchObject({
      paymentStatus: "PENDING",
      fulfilmentStatus: "CONFIRMED",
    });
    await page.goto("/orders");
    await page.getByRole("tab", { name: /^Preparing/ }).click();
    const card = page.getByRole("article", { name: /Asha Received/ });
    // The folded card's summary carries it; the details say what to do next.
    const summary = card.getByRole("button", { name: /Show details/ });
    await expect(summary).toContainText("Customer got it");
    await summary.click();
    await expect(card.getByText("Customer says they got it")).toBeVisible();
    await expect(card.getByText("Collect the payment, then tap Delivered.")).toBeVisible();
    await card.getByRole("button", { name: /Delivered · ₹300\.00 collected/ }).click();
    await page.getByRole("tab", { name: /^Done/ }).click();
    await expect(page.getByRole("article", { name: /Asha Received/ })).toBeVisible();
  });

  test("a pickup, an unknown order and another store's slug are refused", async ({ page, request }) => {
    await createVendorSession(page, request, "received-refused", "/orders");
    const { slug, itemId } = await deliveryStore(page);
    const token = await placeOrder(request, slug, itemId, "Ravi Pickup", "PICKUP");
    await confirm(page, (await boardOrder(page, "Ravi Pickup")).id);

    // Pickups are handed over in person: there is nothing to say "received" to.
    const pickup = await request.post(`/api/s/${slug}/orders/${token}/received`);
    expect(pickup.status()).toBe(409);

    const unknown = await request.post(`/api/s/${slug}/orders/${"x".repeat(32)}/received`);
    expect(unknown.status()).toBe(404);

    // The token only works with its own store's slug.
    const otherStore = await request.post(`/api/s/zz-no-such-store-e2e/orders/${token}/received`);
    expect(otherStore.status()).toBe(404);
  });

  test.describe("paid online", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to mark an order paid online");

    test("a paid delivery is marked delivered by the buyer's tap", async ({ page, request }) => {
      await createVendorSession(page, request, "received-paid", "/orders");
      const { slug, itemId } = await deliveryStore(page);
      const token = await placeOrder(request, slug, itemId, "Meera Paid", "DELIVERY");
      // What Razorpay verify leaves behind: paid and confirmed.
      await markPaidOnlineByOrderId((await boardOrder(page, "Meera Paid")).id);

      const res = await request.post(`/api/s/${slug}/orders/${token}/received`);
      expect(res.status(), await res.text()).toBe(200);
      expect(((await res.json()) as { data: { delivered: boolean } }).data.delivered).toBe(true);
      expect(await boardOrder(page, "Meera Paid")).toMatchObject({
        paymentStatus: "PAID",
        fulfilmentStatus: "DELIVERED",
      });
    });
  });
});
