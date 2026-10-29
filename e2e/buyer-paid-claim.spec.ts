import { expect, test, type Page } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Buyer "I've paid" → seller "Payment received" / "Not received".
 *
 * The buyer's tap only records a claim (UTR optional); the seller answers on
 * the orders board. After a "Not received" the next claim needs a UTR.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const UPI_ID = "e2e-paid-claim@okaxis";
const JSON_HEADERS = { "Content-Type": "application/json" };

async function vendorSlug(page: Page): Promise<string> {
  const res = await page.request.get("/api/vendor");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { vendor: { slug: string } }).vendor.slug;
}

test.describe("buyer marks an order paid, seller confirms or rejects", () => {
  test("I've paid → Not received → UTR → Payment received", async ({ page, request, browser }) => {
    test.setTimeout(300_000);

    const item = `Kaju Katli ${Math.random().toString(36).slice(2, 7)}`;

    // ── Vendor A: UPI ID, menu, publish, menu ordering ────────────────
    await createVendorSession(page, request, "paidclaim", "/menu");
    const slug = await vendorSlug(page);
    await createMenuItem(page, { name: item, priceInRupees: 120, category: "Sweets" });
    for (const data of [
      { upiId: UPI_ID, upiName: "E2E Kitchen" },
      { publishStorefront: true },
      { acceptMenuOrders: true },
    ]) {
      const res = await page.request.patch("/api/vendor", { data, headers: JSON_HEADERS });
      expect(res.status(), JSON.stringify(data)).toBe(200);
    }

    // ── Buyer: order by UPI, tap "I've paid" with no reference ────────
    const buyerCtx = await browser.newContext(CONTEXT_OPTIONS);
    const otherCtx = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${slug}`);
      await buyer.getByRole("button", { name: `Add ${item}` }).click();
      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await sheet.getByLabel("Your name").fill("Claim Buyer");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("radio", { name: /pay now by upi/i }).check();
      await sheet.getByRole("button", { name: /place order · ₹120\.00/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${slug}/o/[^/]+$`), { timeout: 120_000 });
      const orderPath = new URL(buyer.url()).pathname;
      const token = orderPath.split("/").pop() as string;
      const claimUrl = `/api/s/${slug}/orders/${token}/utr`;

      const paidButton = buyer.getByRole("button", { name: "I've paid" });
      await expect(paidButton).toBeVisible();
      expect((await paidButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await paidButton.click();
      await expect(buyer.getByRole("heading", { name: /payment submitted/i })).toBeVisible();
      // No longer asking for payment; the buyer may still add a reference.
      await expect(buyer.getByRole("heading", { name: /pay ₹120\.00/i })).toHaveCount(0);
      await expect(buyer.getByRole("button", { name: "Add reference" })).toBeVisible();

      // ── Seller: sees the claim, answers "Not received" ──────────────
      await page.goto("/orders");
      const card = page.getByRole("article", { name: /Claim Buyer/ });
      await expect(card.getByText(/customer says paid/i).first()).toBeVisible();
      await expect(card.getByText(/Customer says they paid ₹120\.00/)).toBeVisible();
      await expect(card.getByRole("button", { name: "Payment received" })).toBeVisible();
      const notReceived = card.getByRole("button", { name: "Not received" });
      expect((await notReceived.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      // Another vendor cannot answer this order's claim (404, no existence leak).
      type Board = { data: { id: string; paymentStatus: string; fulfilmentStatus: string }[] };
      const board = (await (await page.request.get("/api/storefront-orders")).json()) as Board;
      const orderId = board.data[0].id;
      const other = await otherCtx.newPage();
      await createVendorSession(other, request, "paidclaim-b", "/menu");
      for (const action of ["reject_payment", "mark_paid"]) {
        const forged = await other.request.patch(`/api/storefront-orders/${orderId}`, {
          data: { action },
          headers: JSON_HEADERS,
        });
        expect(forged.status(), `cross-tenant ${action}`).toBe(404);
      }

      await notReceived.click();
      await expect(card.getByRole("button", { name: "Not received" })).toHaveCount(0);
      await expect(card.getByText(/awaiting payment/i).first()).toBeVisible();

      // ── Buyer: told it wasn't found; a bare tap is no longer enough ──
      await buyer.reload();
      await expect(buyer.getByText(/couldn't find your payment/i)).toBeVisible();
      const bare = await buyer.request.post(claimUrl, { data: {}, headers: JSON_HEADERS });
      expect(bare.status()).toBe(400);
      expect(((await bare.json()) as { error: string }).error).toBe("reference_required");
      await buyer.getByRole("button", { name: "I've paid" }).click();
      await expect(buyer.getByText(/Enter the 12-digit UPI reference/)).toBeVisible();

      await buyer.getByLabel(/UPI reference/i).fill("412345678901");
      await buyer.getByRole("button", { name: "I've paid" }).click();
      await expect(buyer.getByRole("heading", { name: /payment submitted/i })).toBeVisible();

      // ── Seller: sees the UTR, answers "Payment received" ────────────
      await page.reload();
      const card2 = page.getByRole("article", { name: /Claim Buyer/ });
      await expect(card2.getByText("412345678901")).toBeVisible();
      // One answer: no separate Confirm beside it, and paying confirms the order.
      await expect(card2.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
      await card2.getByRole("button", { name: "Payment received · Confirm" }).click();
      await expect(card2.getByRole("button", { name: /Payment received/ })).toHaveCount(0);
      const after = (await (await page.request.get("/api/storefront-orders")).json()) as Board;
      expect(after.data.find((o) => o.id === orderId)).toMatchObject({ paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED" });

      // A late "Not received" on a paid order is refused.
      const late = await page.request.patch(`/api/storefront-orders/${orderId}`, {
        data: { action: "reject_payment" },
        headers: JSON_HEADERS,
      });
      expect(late.status()).toBe(409);

      // ── Buyer: paid ─────────────────────────────────────────────────
      await buyer.reload();
      await expect(buyer.getByRole("heading", { name: /^paid$/i })).toBeVisible();
      await expect(buyer.getByText(/couldn't find your payment/i)).toHaveCount(0);
      await expect(buyer.getByRole("button", { name: "I've paid" })).toHaveCount(0);
    } finally {
      await buyerCtx.close();
      await otherCtx.close();
    }
  });
});
