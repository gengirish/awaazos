import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createVendorSession } from "./helpers/vendor";

/**
 * Delivery riders: the owner saves their own delivery people in Settings →
 * Online orders, and a delivery order on the board gets "Send to <name>",
 * a wa.me link to that rider with the order filled in. Tapping it marks the
 * order out for delivery, which the buyer's order page shows as "On the way".
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

/** A store that takes delivery orders from its menu, plus one guest delivery order. */
async function storeWithDeliveryOrder(
  page: Page,
  request: APIRequestContext,
  buyerName: string,
): Promise<{ slug: string; orderToken: string }> {
  const item = await page.request.post("/api/menu", {
    data: { name: "Ragi Laddu", priceInRupees: 150, category: "Sweets" },
  });
  expect(item.status()).toBe(201);
  const { data: menuItem } = (await item.json()) as { data: { id: string } };

  const settings = await page.request.patch("/api/vendor", {
    data: { publishStorefront: true, acceptPayOnDelivery: true, menuFulfilmentMode: "DELIVERY" },
  });
  expect(settings.status()).toBe(200);
  expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: true } })).status()).toBe(200);

  const vendor = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };
  const slug = vendor.vendor.slug;

  const order = await request.post(`/api/s/${slug}/menu-orders`, {
    data: {
      items: [{ menuItemId: menuItem.id, qty: 2 }],
      customerName: buyerName,
      customerPhone: "+919848054321",
      fulfilmentType: "DELIVERY",
      deliveryAddress: "12 Lake Road, Yelahanka",
      paymentMethod: "CASH",
    },
  });
  expect(order.status(), await order.text()).toBe(201);
  const { data } = (await order.json()) as { data: { orderToken: string } };
  return { slug, orderToken: data.orderToken };
}

test.describe("delivery riders", () => {
  test("owner saves a rider; Send to opens WhatsApp to them and puts the order out for delivery", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);
    // The wa.me tab never leaves the test machine.
    await page.context().route(/^https:\/\/wa\.me\//, (route) => route.fulfill({ status: 204, body: "" }));
    await createVendorSession(page, request, "riders", "/settings/orders");
    const { slug, orderToken } = await storeWithDeliveryOrder(page, request, "Asha Rider-Test");

    // ── Settings → Online orders → Delivery riders ─────────────────────
    await page.goto("/settings/orders");
    const card = page.getByRole("region", { name: "Delivery riders" });
    await expect(card.getByText("No riders saved yet.")).toBeVisible();
    await card.getByLabel("Name").fill("Ramesh");
    await card.getByLabel("WhatsApp number").fill("12345");
    await card.getByRole("button", { name: "Add rider" }).click();
    await expect(card.getByText("Enter a 10-digit mobile number.")).toBeVisible();
    await card.getByLabel("WhatsApp number").fill("98765 43210");
    await card.getByRole("button", { name: "Add rider" }).click();
    await expect(card.getByRole("list", { name: "Saved riders" })).toContainText("Ramesh");

    // Saved for real: still there after a reload.
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Delivery riders" }).getByRole("list", { name: "Saved riders" }),
    ).toContainText("98765 43210");

    // ── Board: the delivery order has Send to Ramesh ───────────────────
    await page.goto("/orders");
    const order = page.getByRole("article", { name: /Asha Rider-Test/ });
    const send = order.getByRole("link", { name: /to Ramesh on WhatsApp/ });
    await expect(send).toBeVisible();
    const href = (await send.getAttribute("href")) ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    const text = decodeURIComponent(href.split("?text=")[1] ?? "");
    expect(text).toContain("Address: 12 Lake Road, Yelahanka");
    expect(text).toContain("2 × Ragi Laddu");
    expect(text).toContain("Collect ₹300.00 cash");

    // ── Tapping it hands the order over: out for delivery, with Ramesh ─
    await send.click();
    // It was a new order, so it moves to Confirmed: follow it there.
    await page.getByRole("tab", { name: /^Confirmed/ }).click();
    // Collapsed on Confirmed: the summary line already says so; the details give the time.
    await expect(order).toContainText("Out for delivery with Ramesh");
    await order.getByRole("button", { name: /Show details/ }).click();
    await expect(order).toContainText(/Out for delivery · .+ · with Ramesh/);
    // Gone out: no separate "Out for delivery" button any more; Delivered is next.
    await expect(order.getByRole("button", { name: "Out for delivery" })).toHaveCount(0);
    await expect(order.getByRole("button", { name: /Delivered · ₹300\.00 collected/ })).toBeVisible();

    // ── The buyer sees "On the way" (and never the rider's name) ───────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}/o/${orderToken}`);
      await expect(buyer.getByRole("heading", { name: "On the way" })).toBeVisible();
      await expect(buyer.getByRole("list", { name: "Order progress" })).toContainText("On the way");
      await expect(buyer.locator("body")).not.toContainText("Ramesh");
    } finally {
      await buyerCtx.close();
    }

    // ── Removing the rider removes the button ──────────────────────────
    await page.goto("/settings/orders");
    await page.getByRole("button", { name: "Remove Ramesh" }).click();
    await expect(page.getByRole("region", { name: "Delivery riders" }).getByText("No riders saved yet.")).toBeVisible();
    await page.goto("/orders");
    await page.getByRole("tab", { name: /^Confirmed/ }).click();
    const after = page.getByRole("article", { name: /Asha Rider-Test/ });
    await after.getByRole("button", { name: /Show details/ }).click();
    await expect(after.getByRole("button", { name: /Copy for rider/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /to Ramesh on WhatsApp/ })).toHaveCount(0);
  });
});
