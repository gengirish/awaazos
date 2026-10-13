import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Offers (quantity plans): a kitchen sets up "Weekly Plan: 4+ quiches incl. 1
 * paneer → 10% off", the counter cart and the storefront cart both apply it,
 * and the bill, the receipt and the buyer's order page all show the same
 * server-priced discount.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  return ((await res.json()) as { vendor: { slug: string } }).vendor.slug;
}

test.describe("offers: quantity plan discounts", () => {
  test("seller creates a plan; POS and storefront apply it; bill and receipt agree", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(300_000);

    const suffix = Math.random().toString(36).slice(2, 7);
    const potato = `Potato Quiche ${suffix}`;
    const paneer = `Paneer Quiche ${suffix}`;
    const bhel = `Bhel Puri ${suffix}`;

    await createVendorSession(page, request, "offers", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: potato, priceInRupees: 55, tagsCsv: "quiche", category: "Snacks" });
    await createMenuItem(page, { name: paneer, priceInRupees: 100, tagsCsv: "Quiche, paneer", category: "Snacks" });
    await createMenuItem(page, { name: bhel, priceInRupees: 40, tagsCsv: "snacks", category: "Snacks" });

    // ── Settings → Offers: create the Weekly Plan through the form ─────
    await page.goto("/settings/offers");
    await expect(page.getByRole("heading", { level: 1, name: "Offers" })).toBeVisible();
    await expect(page.getByText("No offers yet")).toBeVisible();
    await page.getByRole("button", { name: "New offer" }).click();
    const form = page.getByRole("dialog", { name: "New offer" });
    await expect(form).toBeVisible();

    // An empty form says what is missing instead of saving.
    await form.getByRole("button", { name: "Create offer" }).click();
    await expect(form.getByText("Give the offer a name")).toBeVisible();

    await form.getByLabel("Name").fill("Weekly Plan");
    await form.getByLabel("Which items count").selectOption("TAG");
    await form.getByLabel("Tag", { exact: true }).fill("quiche");
    await form.getByLabel("Minimum quantity").fill("4");
    await form.getByLabel("Discount (%)").fill("10");
    await form.getByLabel("At least").fill("1");
    await form.getByLabel("Items tagged").fill("paneer");
    await form.getByRole("button", { name: "Create offer" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText('10% off 4 or more items tagged "quiche", including 1 tagged "paneer"')).toBeVisible();
    await expect(page.getByRole("switch", { name: "Weekly Plan active" })).toHaveAttribute("aria-checked", "true");

    // ── Counter: 3 potato quiches → nudge; add a paneer one → 10% off ───
    await page.goto("/pos");
    const cart = page.getByRole("region", { name: "Cart" });
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: new RegExp(`^${potato}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${bhel}`) }).click();
    await expect(cart).toContainText("Add 1 paneer quiche item to unlock 10% off (Weekly Plan)");
    await expect(cart).not.toContainText("Discount");

    await page.getByRole("button", { name: new RegExp(`^${paneer}`) }).click();
    // Quiches 165 + 100 = ₹265 → ₹26.50 off; the Bhel Puri is outside the plan.
    await expect(cart).toContainText("Discount (Weekly Plan)");
    await expect(cart).toContainText("−₹26.50");
    await expect(cart).toContainText("₹278.50");

    await page.getByRole("button", { name: "Collect payment" }).click();
    const pay = page.getByRole("dialog");
    await expect(pay).toContainText("₹278.50");
    await expect(pay).toContainText("Discount (Weekly Plan): −₹26.50");
    await pay.getByRole("button", { name: /Mark as paid/ }).click();
    await expect(page.getByText(/AWZ-\d{8}-\d{4}/).first()).toBeVisible({ timeout: 30_000 });

    const list = await page.request.get("/api/transactions");
    const sale = ((await list.json()) as {
      items: {
        billNumber: string;
        subtotalPaise: number;
        discountPaise: number;
        totalPaise: number;
        offerName: string | null;
        orderItems: { name: string; discountPaise: number }[];
      }[];
    }).items[0]!;
    expect(sale).toMatchObject({ subtotalPaise: 30500, discountPaise: 2650, totalPaise: 27850, offerName: "Weekly Plan" });
    expect(sale.orderItems.find((i) => i.name === bhel)?.discountPaise).toBe(0);
    expect(sale.orderItems.reduce((s, i) => s + i.discountPaise, 0)).toBe(2650);

    // The printed receipt names the offer and adds up.
    await page.goto(`/receipts/${sale.billNumber}`);
    const receipt = page.getByRole("article", { name: `Receipt ${sale.billNumber}` });
    await expect(receipt).toContainText("Subtotal");
    await expect(receipt).toContainText("₹305.00");
    await expect(receipt).toContainText("Discount (Weekly Plan)");
    await expect(receipt).toContainText("−₹26.50");
    await expect(receipt).toContainText("₹278.50");

    // A discount the server cannot reproduce is refused, not recorded.
    const forged = await page.request.post("/api/transactions", {
      data: {
        items: [{ name: bhel, priceInPaise: 4000, qty: 1 }],
        subtotalPaise: 4000,
        discountPaise: 3900,
        taxPaise: 0,
        totalPaise: 100,
        paymentMethod: "CASH",
        source: "MANUAL",
      },
    });
    expect(forged.status()).toBe(400);
    expect(((await forged.json()) as { code: string }).code).toBe("discount_mismatch");

    // ── Storefront: publish, take menu orders, pay on delivery ─────────
    await page.goto("/settings/store");
    const publish = page.getByRole("switch", { name: /publish/i });
    if ((await publish.getAttribute("aria-checked")) !== "true") await publish.click();
    await expect(publish).toHaveAttribute("aria-checked", "true");
    await page.goto("/settings/payments");
    const payOnDelivery = page.getByRole("switch", { name: /pay on delivery/i });
    if ((await payOnDelivery.getAttribute("aria-checked")) !== "true") await payOnDelivery.click();
    await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");
    await page.goto("/settings/orders");
    const menuSwitch = page.getByRole("switch", { name: /order from your menu/i });
    await menuSwitch.click();
    await expect(menuSwitch).toHaveAttribute("aria-checked", "true");

    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      const res = await buyer.goto(`/s/${slug}`);
      expect(res?.status()).toBe(200);

      // The plan is advertised before anything is in the cart.
      await expect(buyer.getByRole("list", { name: "Offers" })).toContainText(
        "Weekly Plan: 4+ quiche items incl. 1 paneer → 10% off",
      );
      // Tags and other vendor-only fields never reach the page source.
      expect(await buyer.content()).not.toContain("eligibleTag");

      await buyer.getByRole("button", { name: `Add ${potato}` }).click();
      await buyer.getByRole("button", { name: `Add one more ${potato}` }).click();
      await buyer.getByRole("button", { name: `Add ${paneer}` }).click();
      await expect(buyer.getByText("Add 1 more quiche item to unlock 10% off (Weekly Plan)")).toBeVisible();

      await buyer.getByRole("button", { name: `Add one more ${potato}` }).click();
      await expect(buyer.getByText("Weekly Plan applied.")).toBeVisible();

      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("Discount (Weekly Plan)");
      await expect(sheet).toContainText("−₹26.50");
      await sheet.getByLabel("Your name").fill("Meera Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("radio", { name: /pay on delivery/i }).check();
      await sheet.getByRole("button", { name: /place order · ₹238\.50/i }).click();

      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      await expect(buyer.getByText("Discount (Weekly Plan)")).toBeVisible();
      await expect(buyer.getByText("−₹26.50")).toBeVisible();
      await expect(buyer.getByText("₹238.50").first()).toBeVisible();
    } finally {
      await buyerCtx.close();
    }

    // The seller's board shows the same discount on the order card.
    await page.goto("/orders");
    const card = page.getByRole("article", { name: /Meera Buyer/ });
    await expect(card).toContainText("Discount (Weekly Plan)");
    await expect(card).toContainText("−₹26.50");

    // ── Switch the plan off: the next cart pays full price ─────────────
    await page.goto("/settings/offers");
    await page.getByRole("switch", { name: "Weekly Plan active" }).click();
    await expect(page.getByRole("switch", { name: "Weekly Plan active" })).toHaveAttribute("aria-checked", "false");
    await page.goto("/pos");
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: new RegExp(`^${potato}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${paneer}`) }).click();
    await expect(page.getByRole("region", { name: "Cart" })).toContainText("₹265.00");
    await expect(page.getByRole("region", { name: "Cart" })).not.toContainText("Discount");
  });
});
