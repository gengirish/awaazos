import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createVendorSession } from "./helpers/vendor";

/**
 * Delivery riders: the owner saves their own delivery people in Settings →
 * Online orders, and a delivery order on the board gets "Send to <name>",
 * a wa.me link to that rider with the order filled in. Tapping it marks the
 * order out for delivery, which the buyer's order page shows as "On the way".
 * The text ends with the rider's own link (/d/<token>), where the rider taps
 * Delivered; a buyer can also say "I've received my order".
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

/** A guest delivery order (pay on delivery, 2 × ₹150). Returns its order token. */
async function placeDeliveryOrder(
  request: APIRequestContext,
  slug: string,
  menuItemId: string,
  buyerName: string,
): Promise<string> {
  const order = await request.post(`/api/s/${slug}/menu-orders`, {
    data: {
      items: [{ menuItemId, qty: 2 }],
      customerName: buyerName,
      customerPhone: "+919848054321",
      fulfilmentType: "DELIVERY",
      deliveryAddress: "12 Lake Road, Yelahanka",
      paymentMethod: "CASH",
    },
  });
  expect(order.status(), await order.text()).toBe(201);
  const { data } = (await order.json()) as { data: { orderToken: string } };
  return data.orderToken;
}

/** A store that takes delivery orders from its menu, plus one guest delivery order. */
async function storeWithDeliveryOrder(
  page: Page,
  request: APIRequestContext,
  buyerName: string,
): Promise<{ slug: string; orderToken: string; menuItemId: string }> {
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

  const orderToken = await placeDeliveryOrder(request, slug, menuItem.id, buyerName);
  return { slug, orderToken, menuItemId: menuItem.id };
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

  test("the rider marks it delivered from their own link; a buyer can say they got it", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);
    await createVendorSession(page, request, "riderlink", "/settings/orders");
    const { slug, menuItemId } = await storeWithDeliveryOrder(page, request, "Kiran Door-Test");
    const save = await page.request.patch("/api/vendor", {
      data: { deliveryRiders: [{ name: "Ramesh", phone: "9876543210" }] },
    });
    expect(save.status()).toBe(200);

    // ── The handoff text ends with the rider's own link ────────────────
    await page.goto("/orders");
    const card = page.getByRole("article", { name: /Kiran Door-Test/ });
    const send = card.getByRole("link", { name: /to Ramesh on WhatsApp/ });
    await expect(send).toHaveAttribute("href", /When%20delivered%2C%20tap%3A%20/);
    const text = decodeURIComponent(((await send.getAttribute("href")) ?? "").split("?text=")[1] ?? "");
    const riderUrl = /When delivered, tap: (\S+)$/.exec(text)?.[1] ?? "";
    expect(riderUrl).toMatch(/\/d\/[A-Za-z0-9_-]{32}$/);

    // ── The rider, signed out, on their phone ──────────────────────────
    const riderCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const riderPage = await riderCtx.newPage();
      const res = await riderPage.goto(new URL(riderUrl).pathname);
      expect(res?.status()).toBe(200);
      await expect(riderPage.getByRole("heading", { level: 1, name: "Kiran Door-Test" })).toBeVisible();
      await expect(riderPage.getByRole("heading", { name: "Collect ₹300.00 cash" })).toBeVisible();
      await expect(riderPage.getByText("12 Lake Road, Yelahanka")).toBeVisible();
      await expect(riderPage.getByRole("link", { name: /Call 98480 54321/ })).toHaveAttribute(
        "href",
        "tel:+919848054321",
      );
      await riderPage.getByRole("button", { name: "Delivered · ₹300.00 collected" }).click();
      await riderPage
        .getByRole("dialog", { name: "Handed it over?" })
        .getByRole("button", { name: "Delivered · ₹300.00 collected" })
        .click();
      await expect(riderPage.getByRole("heading", { name: "Delivered" })).toBeVisible();
      // Done: the buyer's details are gone from the page.
      await expect(riderPage.locator("body")).not.toContainText("Lake Road");

      // An unknown rider link is a plain 404.
      expect((await riderPage.goto("/d/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))?.status()).toBe(404);
    } finally {
      await riderCtx.close();
    }

    // ── The seller's board: delivered, cash collected ──────────────────
    await page.goto("/orders");
    await page.getByRole("tab", { name: /^Delivered/ }).click();
    await expect(page.getByRole("article", { name: /Kiran Door-Test/ })).toBeVisible();

    // ── A buyer says they got theirs (pay on delivery: seller still collects) ─
    const token = await placeDeliveryOrder(request, slug, menuItemId, "Meena Got-It");
    await page.goto("/orders");
    await page.getByRole("article", { name: /Meena Got-It/ }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("tab", { name: /^Confirmed \(1\)/ })).toBeVisible();

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}/o/${token}`);
      await buyer.getByRole("button", { name: "I've received my order" }).click();
      await expect(buyer.getByText("Thanks — the store knows you got it.")).toBeVisible();
    } finally {
      await buyerCtx.close();
    }

    await page.goto("/orders");
    await page.getByRole("tab", { name: /^Confirmed/ }).click();
    const got = page.getByRole("article", { name: /Meena Got-It/ });
    await expect(got).toContainText("Customer got it");
    await got.getByRole("button", { name: /Show details/ }).click();
    await expect(got).toContainText("Collect the payment, then tap Delivered.");
  });
});
