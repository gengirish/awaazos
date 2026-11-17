import { devices, expect, test, type Locator } from "@playwright/test";

import { CONTEXT_OPTIONS, createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Buyer autofill on a phone: the checkout fields carry the autocomplete tokens
 * Chrome and Safari fill a saved name, mobile and address from, plus stable
 * `name`s (a drop's field ids differ per drop, so autofill keys on the name),
 * and the buyer sign-in's email. Checkout sets no enterkeyhint on purpose: Enter there
 * submits the form (the browser's implicit submission), so a "Next" label would lie.
 *
 * Mobile project only: autofill and on-screen keyboards are a phone matter.
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

async function expectAttrs(field: Locator, attrs: Record<string, string | null>) {
  for (const [attr, value] of Object.entries(attrs)) {
    if (value === null) await expect(field, attr).not.toHaveAttribute(attr);
    else await expect(field, attr).toHaveAttribute(attr, value);
  }
}

test.describe("checkout autofill", () => {
  test("checkout and sign-in fields carry autofill tokens and stable names", async ({
    page,
    request,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "autofill and keyboard hints are checked on the phone project");
    test.setTimeout(180_000);

    await createVendorSession(page, request, "autofill", "/menu");
    await createMenuItem(page, { name: "Masala Dosa", priceInRupees: 90, category: "Breakfast" });
    const settings = await page.request.patch("/api/vendor", {
      data: { publishStorefront: true, acceptPayOnDelivery: true, menuFulfilmentMode: "DELIVERY" },
      headers: JSON_HEADERS,
    });
    expect(settings.status(), await settings.text()).toBe(200);
    expect((await page.request.patch("/api/vendor", { data: { acceptMenuOrders: true } })).status()).toBe(200);
    const { vendor } = (await (await page.request.get("/api/vendor")).json()) as { vendor: { slug: string } };

    const buyerCtx = await browser.newContext({ ...devices["Pixel 7"], ...CONTEXT_OPTIONS });
    try {
      const buyer = await buyerCtx.newPage();
      expect((await buyer.goto(`/s/${vendor.slug}`))?.status()).toBe(200);
      await buyer.getByRole("button", { name: "Add Masala Dosa" }).click();
      await buyer.getByRole("button", { name: "Checkout", exact: true }).click();
      const sheet = buyer.getByRole("dialog", { name: "Checkout" });
      await expect(sheet).toBeVisible();

      await expectAttrs(sheet.getByLabel("Your name"), {
        name: "name",
        autocomplete: "name",
      });
      // +91 is printed beside the field, so the national number is what fills it.
      await expectAttrs(sheet.getByLabel("Mobile number"), {
        name: "tel-national",
        type: "tel",
        inputmode: "tel",
        autocomplete: "tel-national",
      });
      await expectAttrs(sheet.getByLabel("House or flat, building, street"), {
        name: "street-address",
        autocomplete: "street-address",
      });
      await expectAttrs(sheet.getByLabel("Area or locality"), {
        name: "address-level3",
        autocomplete: "address-level3",
      });
      // No autocomplete token means "landmark"; Chrome's Indian address profile finds it by its label.
      await expectAttrs(sheet.getByLabel("Landmark (optional)"), { name: "landmark", autocomplete: null });
      // Enter places the order, so no field claims "Next".
      await expect(sheet.locator("[enterkeyhint]")).toHaveCount(0);
      await expectAttrs(sheet.getByLabel("Pincode (optional)"), {
        name: "postal-code",
        inputmode: "numeric",
        autocomplete: "postal-code",
      });

      await sheet.getByRole("button", { name: /add a note/i }).click();
      await expectAttrs(sheet.getByLabel("Note for the store (optional)"), { name: "notes", autocomplete: "off" });

      // ── Buyer sign-in: the magic-link email ──────────────────────────
      expect((await buyer.goto(`/s/${vendor.slug}/account`))?.status()).toBe(200);
      const email = buyer.getByLabel("Email");
      await expectAttrs(email, {
        name: "email",
        type: "email",
        autocomplete: "email",
        enterkeyhint: "send",
        spellcheck: "false",
      });
      // An error is read out with the field it belongs to.
      await email.fill("not-an-email");
      await buyer.getByRole("button", { name: /email me a sign-in link|send/i }).click();
      const describedBy = (await email.getAttribute("aria-describedby")) ?? "";
      expect(describedBy.split(" ")).toContain("customer-email-error");
      await expect(buyer.locator("#customer-email-error")).toBeVisible();
    } finally {
      await buyerCtx.close();
    }
  });
});
