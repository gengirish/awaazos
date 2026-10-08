import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * One full home-kitchen day, end to end: a vendor sets up a pre-order drop,
 * a guest buyer orders against limited stock, the vendor fulfils, and the
 * stock count / oversell guard / prep sheet all agree with each other.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status(), "GET /api/vendor should succeed for a signed-in owner").toBe(200);
  const body = (await res.json()) as { vendor: { slug: string } };
  return body.vendor.slug;
}

/** Add `qty` of an item to the cart inside one drop's section of the storefront. */
async function addToCart(dropSection: ReturnType<Page["getByRole"]>, itemName: string, qty: number) {
  await dropSection.getByRole("button", { name: `Add ${itemName}` }).click();
  for (let i = 1; i < qty; i++) {
    await dropSection.getByRole("button", { name: `Add one more ${itemName}` }).click();
  }
}

/** Fill the checkout sheet as a guest: pickup + pay on delivery. */
async function checkoutPickupPayOnDelivery(page: Page) {
  // One cart on the page, so the page-level cart bar has a single "Checkout".
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Checkout" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Your name").fill("Priya Buyer");
  await sheet.getByLabel("Mobile number").fill("98480 12345");
  await sheet.getByRole("radio", { name: "Pickup" }).check();
  await sheet.getByRole("radio", { name: /pay on delivery/i }).check();
  return sheet;
}

test.describe("drops: home-kitchen pre-order day", () => {
  test("vendor sets up a drop, buyer orders limited stock, vendor fulfils and freezes", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);

    const suffix = Math.random().toString(36).slice(2, 7);
    const laddu = `Besan Laddu ${suffix}`;
    const chakli = `Rice Chakli ${suffix}`;
    const dropTitle = `Diwali sweets ${suffix}`;

    // ── Vendor: register, menu, storefront + payment settings ──────────
    await createVendorSession(page, request, "drops", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: laddu, priceInRupees: 120, category: "Sweets" });
    await createMenuItem(page, { name: chakli, priceInRupees: 80, category: "Snacks" });

    await page.goto("/settings/store");
    const publish = page.getByRole("switch", { name: /publish/i });
    await expect(publish).toHaveAttribute("aria-checked", "false");
    await publish.click();
    await expect(publish).toHaveAttribute("aria-checked", "true");

    await page.goto("/settings/payments");
    const payOnDelivery = page.getByRole("switch", { name: /pay on delivery/i });
    await expect(payOnDelivery).toBeVisible();
    if ((await payOnDelivery.getAttribute("aria-checked")) !== "true") {
      await payOnDelivery.click();
    }
    await expect(payOnDelivery).toHaveAttribute("aria-checked", "true");

    // UPI ID through the Payments form: a typo is caught inline, then it saves.
    const upiId = page.getByLabel("UPI ID", { exact: true });
    await upiId.fill("e2e-kitchen");
    await page.getByLabel("Name shown on UPI apps").fill("E2E Kitchen");
    await page.getByRole("button", { name: "Save UPI details" }).click();
    await expect(upiId).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/doesn't look like a UPI ID/)).toBeVisible();
    await upiId.fill("e2e-kitchen@okaxis");
    await expect(upiId).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Save UPI details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("UPI ID", { exact: true })).toHaveValue("e2e-kitchen@okaxis");

    // ── Vendor: build the drop ─────────────────────────────────────────
    await page.goto("/drops/new");
    await expect(page.getByRole("heading", { name: "New drop" })).toBeVisible();
    await page.getByLabel("Title").fill(dropTitle);
    await page.getByRole("radio", { name: "Both" }).click();
    await expect(page.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "true");

    // The form defaults the cut-off to tonight 21:00 (or tomorrow 10:00 if it's
    // already late), cooking day tomorrow — always in the future.
    await page.getByRole("checkbox", { name: new RegExp(laddu) }).check();
    await page.getByRole("checkbox", { name: new RegExp(chakli) }).check();
    const ladduRow = page.getByRole("listitem").filter({ hasText: laddu });
    await ladduRow.getByLabel("How many can you make?").fill("3");

    await page.getByRole("button", { name: "Create drop" }).click();
    // Generous: next dev compiles the edit route on first hit.
    await page.waitForURL(/\/drops\/[^/]+\/edit$/, { timeout: 120_000 });
    const dropId = new URL(page.url()).pathname.split("/")[2];
    expect(dropId).toBeTruthy();

    await page.getByRole("button", { name: "Open orders" }).click();
    // exact: the form also has "Start taking orders later…", which a substring match would hit
    // before the PATCH lands.
    const status = page.getByRole("region", { name: "Status" });
    await expect(status.getByText("Taking orders", { exact: true })).toBeVisible();

    // ── Buyer: guest, separate browser context ─────────────────────────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    // The stale view lives in its own context: carts persist in localStorage per
    // drop, so a same-context tab would hand its 2-laddu cart to the buyer tab.
    const staleCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      // A second browser opened now keeps a stale view (3 left) for the oversell check later.
      const stale = await staleCtx.newPage();
      await stale.goto(`/s/${slug}`);
      const staleDrop = stale.getByRole("region", { name: dropTitle });
      await expect(staleDrop.getByText("Only 3 left")).toBeVisible();
      await addToCart(staleDrop, laddu, 2);

      const buyer = await buyerCtx.newPage();
      const res = await buyer.goto(`/s/${slug}`);
      expect(res?.status()).toBe(200);
      const drop = buyer.getByRole("region", { name: dropTitle });
      await expect(drop).toBeVisible();
      await expect(drop.getByText("Only 3 left")).toBeVisible();

      await addToCart(drop, laddu, 2);
      const sheet = await checkoutPickupPayOnDelivery(buyer);
      await sheet.getByRole("button", { name: /place order/i }).click();

      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByRole("heading", { name: "Your order" })).toBeVisible();
      await expect(buyer.getByText("Pay on delivery").first()).toBeVisible();

      // ── Vendor: the board shows it; hand over and collect cash ─────────
      await page.goto(`/drops/${dropId}`);
      const card = page.getByRole("article", { name: /Priya Buyer/ });
      await expect(card).toBeVisible();
      await expect(card.getByText(`2 × ${laddu}`)).toBeVisible();
      await expect(card.getByText("Pay on delivery")).toBeVisible();

      await card.getByRole("button", { name: /picked up · ₹240\.00 collected/i }).click();

      await page.getByRole("tab", { name: /^Delivered/ }).click();
      const delivered = page.getByRole("article", { name: /Priya Buyer/ });
      await expect(delivered.getByText("Delivered", { exact: true })).toBeVisible();
      // Cash collected at handover marks it paid.
      await expect(page.getByRole("listitem").filter({ hasText: /^Paid/ })).toContainText("₹240.00");

      // ── Buyer: stock reflects the sale; a stale cart cannot oversell ───
      await buyer.goto(`/s/${slug}`);
      await expect(buyer.getByRole("region", { name: dropTitle }).getByText("Only 1 left")).toBeVisible();

      const staleSheet = await checkoutPickupPayOnDelivery(stale);
      await staleSheet.getByRole("button", { name: /place order/i }).click();
      await expect(staleSheet.getByRole("alert")).toContainText(/only 1 left now/i);
      expect(stale.url()).not.toMatch(/\/o\//);
    } finally {
      await buyerCtx.close();
      await staleCtx.close();
    }

    // ── Vendor: freeze, then the prep sheet has the right totals ─────────
    await page.goto(`/drops/${dropId}/edit`);
    await page.getByRole("button", { name: "Freeze orders" }).click();
    const confirm = page.getByRole("dialog", { name: "Freeze orders?" });
    await confirm.getByRole("button", { name: "Freeze orders" }).click();
    await expect(confirm).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Status" }).getByText("Orders frozen", { exact: true }),
    ).toBeVisible();

    await page.goto(`/drops/${dropId}/prep`);
    const cook = page.getByRole("region", { name: "1. Cook list" });
    const ladduLine = cook.getByRole("row", { name: new RegExp(laddu) });
    await expect(ladduLine.getByRole("cell").nth(1)).toHaveText("2");
    await expect(ladduLine.getByRole("cell").nth(2)).toHaveText("2/3");
    // Chakli was offered but not ordered, so it is not on the cook list.
    await expect(cook.getByRole("row", { name: new RegExp(chakli) })).toHaveCount(0);
    await expect(cook.getByRole("row", { name: /total items/i }).getByRole("cell")).toHaveText(["2", ""]);
    // Frozen: no "orders can still change" warning.
    await expect(page.getByText("Orders can still change")).toHaveCount(0);
  });
});
