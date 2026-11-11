import { expect, test } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * The seller's own WhatsApp group / channel link (lib/whatsapp-community.ts):
 * saved in Settings → Online store, shown on the store page and the buyer's
 * order page. Only group invites and channel links are accepted.
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const CODE = "E3hKX9ZqLmN8aB2cD4eF6g";
const GROUP = `https://chat.whatsapp.com/${CODE}`;

test("a WhatsApp group link saved in Settings shows on the store and the order page", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(240_000);

  await createVendorSession(page, request, "wa-group", "/menu");
  const { slug } = await openStoreForMenuOrders(page);
  const item = await createMenuItem(page, { name: `Ragi laddu ${Math.random().toString(36).slice(2, 7)}`, priceInRupees: 40 });

  // Anything but a group invite or channel link is refused.
  const bad = await page.request.patch("/api/vendor", {
    data: { whatsappCommunityUrl: "https://wa.me/919876543210" },
    headers: JSON_HEADERS,
  });
  expect(bad.status()).toBe(400);

  // Saved from Settings, pasted the way WhatsApp copies it; stored canonical.
  await page.goto("/settings/store");
  const field = page.getByLabel(/group or channel link/i);
  await field.fill(`chat.whatsapp.com/${CODE}?mode=ems_copy_t`);
  // Several cards on this page have a Save button; this one sits after the field.
  await field.locator("xpath=following-sibling::button[1]").click();
  await expect(page.getByText("WhatsApp link saved.")).toBeVisible();
  const saved = (await (await page.request.get("/api/vendor")).json()) as {
    vendor: { settings: { whatsappCommunityUrl: string | null } };
  };
  expect(saved.vendor.settings.whatsappCommunityUrl).toBe(GROUP);

  const order = await page.request.post(`/api/s/${slug}/menu-orders`, {
    data: {
      items: [{ menuItemId: item.id, qty: 1 }],
      customerName: "Asha",
      customerPhone: "+919848054321",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    },
    headers: JSON_HEADERS,
  });
  expect(order.status(), await order.text()).toBe(201);
  const token = ((await order.json()) as { data: { orderToken: string } }).data.orderToken;

  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const buyer = await ctx.newPage();
    await buyer.goto(`/s/${slug}`);
    const join = buyer.getByRole("list", { name: "Contact" }).getByRole("link", { name: "Join our WhatsApp group" });
    await expect(join).toHaveAttribute("href", GROUP);
    await expect(join).toHaveAttribute("rel", /noopener/);
    expect((await join.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await buyer.goto(`/s/${slug}/o/${token}`);
    const card = buyer.getByRole("region", { name: /next orders/i });
    await expect(card.getByRole("link", { name: "Join our WhatsApp group" })).toHaveAttribute("href", GROUP);
  } finally {
    await ctx.close();
  }

  // Clearing it removes the link.
  expect(
    (await page.request.patch("/api/vendor", { data: { whatsappCommunityUrl: "" }, headers: JSON_HEADERS })).status(),
  ).toBe(200);
  const plain = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const buyer = await plain.newPage();
    await buyer.goto(`/s/${slug}`);
    await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await buyer.content()).not.toContain("chat.whatsapp.com");
  } finally {
    await plain.close();
  }
});
