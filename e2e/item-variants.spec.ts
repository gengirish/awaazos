import { expect, test, type Page } from "@playwright/test";

import { createMenuItem, createVendorSession, openStoreForMenuOrders, type MenuItemRow } from "./helpers/vendor";

/** Sizes and colours of a product (lib/item-variants.ts). */

const JSON_HEADERS = { "Content-Type": "application/json" };

type VariantRow = {
  id: string;
  label: string;
  priceInPaise: number | null;
  isAvailable: boolean;
  stockQty: number | null;
  stockLeft: number | null;
};

async function putVariants(page: Page, itemId: string, variants: object[]) {
  return page.request.put(`/api/menu/${itemId}/variants`, { data: { variants }, headers: JSON_HEADERS });
}

async function variantsOf(page: Page, itemId: string): Promise<VariantRow[]> {
  const list = await page.request.get("/api/menu");
  expect(list.status()).toBe(200);
  const rows = (await list.json()) as { data: (MenuItemRow & { variants: VariantRow[] })[] };
  return rows.data.find((i) => i.id === itemId)?.variants ?? [];
}

function istYmd(days: number): string {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return istNow.toISOString().slice(0, 10);
}

function menuOrder(page: Page, slug: string, items: object[]) {
  return page.request.post(`/api/s/${slug}/menu-orders`, {
    data: {
      items,
      customerName: "Meera",
      customerPhone: "+919848054321",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    },
    headers: JSON_HEADERS,
  });
}

test.describe("item variants", () => {
  test("sizes API: replace the list, order by size, stock per size", async ({ page, request }) => {
    await createVendorSession(page, request, "variants-api");
    const kurti = await createMenuItem(page, { name: "Cotton Kurti", priceInRupees: 599 });
    const store = await openStoreForMenuOrders(page);

    // Bad lists are refused whole.
    for (const bad of [[{ label: "M" }, { label: "m" }], [{ label: "" }], [{ label: "M", priceInRupees: 0 }]]) {
      const res = await putVariants(page, kurti.id, bad);
      expect(res.status(), JSON.stringify(bad)).toBe(400);
    }

    const put = await putVariants(page, kurti.id, [
      { label: "S", stockQty: 2 },
      { label: "M", priceInRupees: 649 },
      { label: "L", isAvailable: false },
    ]);
    expect(put.status(), await put.text()).toBe(200);
    const sizes = (await put.json()).data as VariantRow[];
    expect(sizes.map((v) => [v.label, v.priceInPaise, v.isAvailable, v.stockQty, v.stockLeft])).toEqual([
      ["S", null, true, 2, 2],
      ["M", 64900, true, null, null],
      ["L", null, false, null, null],
    ]);
    const [s, m, l] = sizes;

    // The item keeps no count of its own now.
    const itemCount = await page.request.post(`/api/menu/${kurti.id}/stock`, { data: { set: 5 } });
    expect(itemCount.status()).toBe(409);
    expect(await itemCount.json()).toMatchObject({ error: "has_variants" });

    // Buyers must pick an offered size; S has 2.
    const noSize = await menuOrder(page, store.slug, [{ menuItemId: kurti.id, qty: 1 }]);
    expect(noSize.status()).toBe(409);
    expect(await noSize.json()).toMatchObject({ error: "size_required", menuItemId: kurti.id });
    const off = await menuOrder(page, store.slug, [{ menuItemId: kurti.id, variantId: l.id, qty: 1 }]);
    expect(await off.json()).toMatchObject({ error: "item_not_found", variantId: l.id });
    const tooMany = await menuOrder(page, store.slug, [{ menuItemId: kurti.id, variantId: s.id, qty: 3 }]);
    expect(await tooMany.json()).toMatchObject({ error: "out_of_stock", variantId: s.id, remaining: 2 });

    const ok = await menuOrder(page, store.slug, [
      { menuItemId: kurti.id, variantId: s.id, qty: 2 },
      { menuItemId: kurti.id, variantId: m.id, qty: 1 },
    ]);
    expect(ok.status(), await ok.text()).toBe(201);
    expect((await ok.json()).data.totalPaise).toBe(2 * 59900 + 64900);
    expect((await variantsOf(page, kurti.id)).find((v) => v.id === s.id)?.stockLeft).toBe(0);

    // −1 / +1 / Set count act on one size.
    const plus = await page.request.post(`/api/menu/${kurti.id}/stock`, { data: { variantId: s.id, adjust: 3 } });
    expect(plus.status(), await plus.text()).toBe(200);
    expect(await plus.json()).toMatchObject({ data: { variantId: s.id, stockLeft: 3 } });
    const untracked = await page.request.post(`/api/menu/${kurti.id}/stock`, { data: { variantId: m.id, adjust: 1 } });
    expect(untracked.status()).toBe(409);

    // Removing a size keeps the rest; an empty list removes them all.
    const fewer = await putVariants(page, kurti.id, [{ id: m.id, label: "M", priceInRupees: 649 }]);
    expect(((await fewer.json()).data as VariantRow[]).map((v) => v.label)).toEqual(["M"]);
    const none = await putVariants(page, kurti.id, []);
    expect((await none.json()).data).toEqual([]);
    const plain = await menuOrder(page, store.slug, [{ menuItemId: kurti.id, qty: 1 }]);
    expect(plain.status(), await plain.text()).toBe(201);
  });

  test("drops don't take items with sizes yet, and an item in a drop can't get them", async ({ page, request }) => {
    await createVendorSession(page, request, "variants-drops");
    const sized = await createMenuItem(page, { name: "Linen Shirt", priceInRupees: 899 });
    const plain = await createMenuItem(page, { name: "Tote Bag", priceInRupees: 299 });
    expect((await putVariants(page, sized.id, [{ label: "M" }])).status()).toBe(200);

    const dropBody = (items: { menuItemId: string; priceInPaise: number }[]) => ({
      title: "Weekend stock",
      note: "Ready on Saturday.",
      date: istYmd(2),
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "19:00",
      pickupNote: "Gate 2",
      deliveryFeePaise: 0,
      closesAtDate: istYmd(1),
      closesAtTime: "21:00",
      showEverydayMenu: true,
      items,
    });
    const refused = await page.request.post("/api/drops", {
      data: dropBody([{ menuItemId: sized.id, priceInPaise: 89900 }]),
      headers: JSON_HEADERS,
    });
    expect(refused.status()).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("sizes or colours");

    const created = await page.request.post("/api/drops", {
      data: dropBody([{ menuItemId: plain.id, priceInPaise: 29900 }]),
      headers: JSON_HEADERS,
    });
    expect(created.status(), await created.text()).toBe(201);
    const inDrop = await putVariants(page, plain.id, [{ label: "Blue" }]);
    expect(inDrop.status()).toBe(409);
    expect(await inDrop.json()).toMatchObject({ error: "item_in_drop" });
  });

  test("buyer picks a size; the cart and checkout name it", async ({ page, request, browser }) => {
    await createVendorSession(page, request, "variants-buyer");
    const kurti = await createMenuItem(page, { name: "Block Print Kurti", priceInRupees: 599 });
    const store = await openStoreForMenuOrders(page);
    const put = await putVariants(page, kurti.id, [
      { label: "S", stockQty: 0 },
      { label: "M" },
      { label: "L", priceInRupees: 699 },
    ]);
    expect(put.status(), await put.text()).toBe(200);

    const buyerCtx = await browser.newContext();
    try {
      const buyer = await buyerCtx.newPage();
      await buyer.goto(`/s/${store.slug}`);
      const options = buyer.getByRole("group", { name: "Block Print Kurti: size or colour" });
      await expect(options).toBeVisible();
      // Sold out: offered, not pickable, and says so in words.
      await expect(options.getByRole("radio", { name: "S, sold out" })).toBeDisabled();
      // The first size that can be bought starts picked.
      await expect(options.getByRole("radio", { name: "M" })).toBeChecked();
      await buyer.getByRole("button", { name: "Add Block Print Kurti – M" }).click();
      await options.getByText("L", { exact: true }).click();
      await buyer.getByRole("button", { name: "Add Block Print Kurti – L" }).click();
      await expect(buyer.getByText("In cart: M × 1, L × 1")).toBeVisible();

      await buyer.getByRole("button", { name: "Checkout" }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      const cart = sheet.getByRole("list", { name: "Items in your cart" });
      await expect(cart.getByText("Block Print Kurti – M")).toBeVisible();
      await expect(cart.getByText("Block Print Kurti – L")).toBeVisible();
      await sheet.getByLabel("Your name").fill("Meera");
      await sheet.getByLabel("Mobile number").fill("98480 54321");
      await sheet.getByRole("button", { name: /place order(?: & pay)? · ₹1,298\.00/i }).click();
      await buyer.waitForURL(new RegExp(`/s/${store.slug}/o/[^/]+$`), { timeout: 120_000 });
      await expect(buyer.getByText("Block Print Kurti – L")).toBeVisible();
    } finally {
      await buyerCtx.close();
    }
  });

  test("counter sells by size: picker, cart line, bill and stock per size", async ({ page, request }) => {
    await createVendorSession(page, request, "variants-pos");
    const kurti = await createMenuItem(page, { name: "Counter Kurti", priceInRupees: 599 });
    const other = await createMenuItem(page, { name: "Other Kurti", priceInRupees: 499 });
    const put = await putVariants(page, kurti.id, [
      { label: "M", stockQty: 3 },
      { label: "L", priceInRupees: 699 },
      { label: "XL", isAvailable: false },
    ]);
    expect(put.status(), await put.text()).toBe(200);
    const [m, l] = (await put.json()).data as VariantRow[];
    const otherPut = await putVariants(page, other.id, [{ label: "S" }]);
    const [otherS] = (await otherPut.json()).data as VariantRow[];

    // A size that isn't this item's is refused on a live sale.
    const sale = (variantId: string) => ({
      items: [{ menuItemId: kurti.id, variantId, name: "Counter Kurti – M", priceInPaise: 59900, qty: 1 }],
      subtotalPaise: 59900,
      taxPaise: 0,
      totalPaise: 59900,
      paymentMethod: "CASH",
      source: "MANUAL",
    });
    const foreign = await page.request.post("/api/transactions", { data: sale(otherS!.id), headers: JSON_HEADERS });
    expect(foreign.status()).toBe(400);
    expect(await foreign.json()).toMatchObject({ error: "size_not_found" });

    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
    const tile = page.getByRole("button", { name: /^Counter Kurti from ₹599\.00/ });
    await tile.click();
    const picker = page.getByRole("dialog", { name: "Counter Kurti" });
    // Switched-off sizes are not offered.
    await expect(picker.getByRole("button", { name: /^XL/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /^M ₹599\.00 3 in stock/ }).click();
    await expect(picker).toBeHidden();
    await tile.click();
    await page.getByRole("dialog", { name: "Counter Kurti" }).getByRole("button", { name: /^L ₹699\.00/ }).click();

    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart.getByText("Counter Kurti – M")).toBeVisible();
    await expect(cart.getByText("Counter Kurti – L")).toBeVisible();
    await page.getByRole("button", { name: "Increase Counter Kurti – M" }).click();
    await expect(tile).toHaveAccessibleName(/3 in cart/);

    await page.getByRole("button", { name: "Collect payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Cash" }).check();
    await dialog.getByRole("button", { name: /Mark as paid/ }).click();
    await expect(page.getByText(/Paid ₹1,897\.00 via Cash/)).toBeVisible();

    // The bill names each size, and M's stock went down by the 2 sold.
    await expect
      .poll(async () => (await variantsOf(page, kurti.id)).find((v) => v.id === m!.id)?.stockLeft)
      .toBe(1);
    const bills = await page.request.get("/api/transactions?limit=5");
    const list = (await bills.json()) as {
      items: { orderItems: { name: string; qty: number; variantId: string | null; priceInPaise: number }[] }[];
    };
    expect(
      list.items[0]!.orderItems.map((i) => [i.name, i.qty, i.priceInPaise, i.variantId]).sort(),
    ).toEqual(
      [
        ["Counter Kurti – L", 1, 69900, l!.id],
        ["Counter Kurti – M", 2, 59900, m!.id],
      ].sort(),
    );
  });

  test("seller adds sizes in the item form (goods store, sizes switched on)", async ({ page, request }) => {
    test.skip(process.env.ITEM_VARIANTS_ENABLED !== "true", "needs ITEM_VARIANTS_ENABLED=true on the server");
    await createVendorSession(page, request, "variants-form");
    const kind = await page.request.patch("/api/vendor", { data: { stallType: "CLOTHING" }, headers: JSON_HEADERS });
    expect(kind.ok(), await kind.text()).toBe(true);
    const tee = await createMenuItem(page, { name: "Slub Tee", priceInRupees: 499 });

    await page.goto("/menu");
    await page.getByRole("button", { name: "Edit Slub Tee" }).click();
    const dialog = page.getByRole("dialog");
    const sizes = dialog.getByRole("group", { name: /Sizes or colours/ });
    await sizes.getByRole("button", { name: "Add a size or colour" }).click();
    await sizes.getByRole("button", { name: "Add a size or colour" }).click();
    await sizes.getByLabel("Name").nth(0).fill("M");
    await sizes.getByLabel("In stock").nth(0).fill("4");
    await sizes.getByLabel("Name").nth(1).fill("m");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sizes.getByText("Each name only once")).toBeVisible();

    await sizes.getByLabel("Name").nth(1).fill("XL");
    await sizes.getByLabel("Price (₹)").nth(1).fill("549");
    // Counted per size: the item's own stock switch is gone.
    await expect(dialog.getByRole("switch", { name: "Track stock" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();

    const card = page.getByRole("list", { name: "Slub Tee: sizes or colours" });
    await expect(card.getByText("M", { exact: true })).toBeVisible();
    await expect(card).toContainText("4 in stock");
    await expect(card).toContainText("₹549.00");
    expect((await variantsOf(page, tee.id)).map((v) => [v.label, v.stockQty, v.priceInPaise])).toEqual([
      ["M", 4, null],
      ["XL", null, 54900],
    ]);

    // Reopening shows the saved rows; saving untouched keeps the count (no fresh count sent).
    await page.getByRole("button", { name: "Edit Slub Tee" }).click();
    await expect(sizes.getByLabel("Name").nth(0)).toHaveValue("M");
    await expect(sizes.getByLabel("In stock").nth(0)).toHaveValue("4");
    await sizes.getByRole("button", { name: "Remove XL" }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await variantsOf(page, tee.id)).map((v) => v.label)).toEqual(["M"]);
  });
});
