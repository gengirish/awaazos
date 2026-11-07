import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Delivery areas (lib/delivery-areas.ts): the owner lists the localities they
 * deliver to in Settings → Online orders, each with an optional fee. The store
 * page says where delivery is free, checkout offers the list instead of a
 * free-text locality and charges that area's fee, and the order route refuses
 * any other locality (`outside_delivery_area`), so the fee is never a guess.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

test.describe("delivery areas", () => {
  test("owner lists areas; buyers pick one, pay its fee, and can't order elsewhere", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);

    await createVendorSession(page, request, "areas", "/settings/orders");
    const item = await createMenuItem(page, { name: "Ragi Laddu", priceInRupees: 150, category: "Sweets" });
    // Delivery-only menu orders at a usual ₹30 fee; pay on delivery is the payment method.
    const settings = await page.request.patch("/api/vendor", {
      data: {
        publishStorefront: true,
        acceptPayOnDelivery: true,
        menuFulfilmentMode: "DELIVERY",
        menuDeliveryFeePaise: 3000,
      },
      headers: JSON_HEADERS,
    });
    expect(settings.status(), await settings.text()).toBe(200);
    expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: true } })).status()).toBe(200);
    const { vendor } = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };

    // ── Settings → Online orders → Delivery areas ──────────────────────
    await page.goto("/settings/orders");
    const card = page.getByRole("region", { name: "Delivery areas" });
    await expect(card.getByText("No areas set.", { exact: false })).toBeVisible();
    const areaName = card.getByLabel("Area", { exact: true });
    const areaFee = card.getByLabel("Fee in ₹ (optional)");
    const addArea = card.getByRole("button", { name: "Add area" });
    const list = card.getByRole("list", { name: "Delivery areas" });

    // A fee that isn't a number is refused before anything is saved.
    await areaName.fill("Kondapur");
    await areaFee.fill("free");
    await addArea.click();
    await expect(card.getByText(/Enter a fee up to ₹1,000/)).toBeVisible();
    await expect(list).toHaveCount(0);

    await areaFee.fill("0");
    await addArea.click();
    await expect(list.getByText("Kondapur")).toBeVisible();
    await expect(list).toContainText("Free delivery");

    // Empty fee → the menu's usual ₹30.
    await areaName.fill("Gachibowli");
    await addArea.click();
    await expect(list.getByText("Gachibowli")).toBeVisible();
    await expect(list).toContainText("Usual delivery fee");

    await areaName.fill("Madhapur");
    await areaFee.fill("50");
    await addArea.click();
    await expect(list.getByText("Madhapur")).toBeVisible();

    // The same area again, however it is typed, is a duplicate.
    await areaName.fill(" kondapur ");
    await addArea.click();
    await expect(card.getByText("kondapur is already on the list.", { exact: false })).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(3);

    await card.getByRole("button", { name: "Remove Madhapur" }).click();
    await expect(list.getByText("Madhapur")).toHaveCount(0);
    await expect(list.getByRole("listitem")).toHaveCount(2);

    // Saved, not only on screen.
    await page.reload();
    await expect(page.getByRole("region", { name: "Delivery areas" }).getByRole("listitem")).toHaveCount(2);

    // ── Buyer: the store page and checkout ─────────────────────────────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      expect((await buyer.goto(`/s/${vendor.slug}`))?.status()).toBe(200);
      await expect(buyer.getByText("Free delivery in Kondapur · ₹30 delivery in Gachibowli").first()).toBeVisible();

      await buyer.getByRole("button", { name: "Add Ragi Laddu" }).click();
      await buyer.getByRole("button", { name: "Checkout", exact: true }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();

      await sheet.getByLabel("Your name").fill("Asha Areas");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByLabel("House or flat, building, street").fill("Flat 302, Lake View Apartments");

      // A list, not a text box: the areas name their fee when the fees differ.
      const area = sheet.getByLabel("Area", { exact: true });
      await expect(area.locator("option")).toHaveText(["Choose your area", "Kondapur (free)", "Gachibowli (+₹30)"]);

      // Placing without an area points at the field.
      await sheet.getByRole("button", { name: /place order/i }).click();
      await expect(sheet.getByText("Please choose your area.")).toBeVisible();

      // Gachibowli takes the usual ₹30: ₹150 + ₹30.
      await area.selectOption("Gachibowli");
      const place = sheet.getByRole("button", { name: /place order(?: & pay)? · ₹180\.00/i });
      await expect(place).toBeVisible();
      // Kondapur is free: the total follows the area.
      await area.selectOption("Kondapur");
      await expect(sheet.getByRole("button", { name: /place order(?: & pay)? · ₹150\.00/i })).toBeVisible();
      await area.selectOption("Gachibowli");
      await place.click();

      await buyer.waitForURL(new RegExp(`/s/${vendor.slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      await expect(buyer.getByText("₹180.00").first()).toBeVisible();
    } finally {
      await buyerCtx.close();
    }

    // ── The order route: the server prices the area, and refuses others ─
    const order = (locality: string) =>
      request.post(`/api/s/${vendor.slug}/menu-orders`, {
        data: {
          items: [{ menuItemId: item.id, qty: 1 }],
          customerName: "Ravi Areas",
          customerPhone: "+919848054322",
          fulfilmentType: "DELIVERY",
          deliveryAddress: "12 Lake Road",
          deliveryLocality: locality,
          paymentMethod: "CASH",
        },
        headers: JSON_HEADERS,
      });

    const outside = await order("Banjara Hills");
    expect(outside.status()).toBe(409);
    expect(((await outside.json()) as { error: string }).error).toBe("outside_delivery_area");

    // Matched however it is typed, and charged that area's fee (free), not the usual ₹30.
    const free = await order("  KONDAPUR ");
    expect(free.status(), await free.text()).toBe(201);
    expect(((await free.json()) as { data: { totalPaise: number } }).data.totalPaise).toBe(15000);

    // ── Seller: both orders reach the board ────────────────────────────
    await page.goto("/orders");
    await expect(page.getByRole("article", { name: /Asha Areas/ })).toBeVisible();
    await expect(page.getByRole("article", { name: /Ravi Areas/ })).toBeVisible();
  });
});
