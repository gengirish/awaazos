import { expect, test } from "@playwright/test";

import { registerVendor, signIn } from "./helpers/vendor";

/**
 * First-run setup asks for an answer on every step (docs/ONBOARDING_PLAN.md):
 * a way to get paid, at least one item, how orders come in, pickup or
 * delivery; the contact step is optional but checked; the last step shows
 * every answer and publishes the store, or finishes without publishing.
 * Writes real rows (vendors, menu items): throwaway Postgres only (CLAUDE.md).
 */

const NEXT = { name: "Next", exact: true } as const;

test.describe("setup steps", () => {
  test("every step needs its answer, nothing is skippable, and Publish ends on a live store", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const creds = await registerVendor(request, "onb-steps");
    await signIn(page, creds, "/onboarding");

    await page.getByLabel("City").fill("Pune");
    await page.getByLabel("State").fill("Maharashtra");
    await page.getByRole("button", NEXT).click();

    // ── Getting paid: UPI is ticked to begin with, pay on delivery is not ──
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    const upi = page.getByRole("checkbox", { name: /^UPI/ });
    const pod = page.getByRole("checkbox", { name: /^Pay on delivery/ });
    await expect(upi).toBeChecked();
    await expect(pod).not.toBeChecked();

    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Enter your UPI ID, or untick UPI.")).toBeVisible();
    await expect(page.getByLabel("UPI ID", { exact: true })).toBeFocused();

    await upi.uncheck();
    await expect(page.getByLabel("UPI ID", { exact: true })).toHaveCount(0);
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose at least one way customers can pay you." })).toBeVisible();

    await pod.check();
    await page.getByRole("button", NEXT).click();

    // ── What you sell: one item with a price, typed ──
    await expect(page.getByRole("heading", { name: "What you sell" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Add at least one dish with its price.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Puran Poli");
    await page.getByLabel("Price (₹)").fill("60");
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("heading", { name: "How you take orders" })).toBeVisible();

    const res = await page.request.get("/api/vendor");
    const { vendor } = (await res.json()) as {
      vendor: { upiId: string | null; onboardingStep: number | null; settings: { acceptPayOnDelivery: boolean } };
    };
    expect(vendor.upiId).toBeNull();
    expect(vendor.settings.acceptPayOnDelivery).toBe(true);
    expect(vendor.onboardingStep).toBe(3);

    // A reload reopens the step after the last one answered, and the payment step shows what was saved.
    await page.reload();
    await expect(page.getByRole("heading", { name: "How you take orders" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(upi).not.toBeChecked();
    await expect(pod).toBeChecked();
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("heading", { name: "What you sell" })).toBeVisible();
    await expect(page.getByText("Puran Poli")).toBeVisible();
    await page.getByRole("button", NEXT).click();

    // ── How you take orders: a pick is required; menu orders save before the store is published ──
    await expect(page.getByRole("heading", { name: "How you take orders" })).toBeVisible();
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Choose how customers order from you.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: /^Order from menu/ }).check();
    await page.getByRole("button", NEXT).click();

    // ── Pickup or delivery: a pick, and a fee when delivering; areas are optional ──
    await expect(page.getByRole("heading", { name: "Pickup or delivery" })).toBeVisible();
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Choose how customers get their order.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: /^Delivery/ }).check();
    await expect(page.getByLabel("Pickup note (optional)")).toHaveCount(0);
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText(/^Enter your delivery fee/)).toBeVisible();
    await expect(page.getByLabel("Delivery fee (₹)")).toBeFocused();
    await page.getByLabel("Delivery fee (₹)").fill("30");
    await page.getByLabel("Area", { exact: true }).fill("Kondapur");
    await page.getByLabel("Fee in ₹ (optional)").fill("0");
    await page.getByRole("button", { name: "Add area" }).click();
    const areas = page.getByRole("list", { name: "Delivery areas" });
    await expect(areas.getByText("Kondapur")).toBeVisible();
    await expect(areas.getByText("· Free delivery")).toBeVisible();
    await page.getByLabel("Area", { exact: true }).fill("kondapur ");
    await page.getByRole("button", { name: "Add area" }).click();
    await expect(page.getByText("Kondapur is already on the list.")).toBeVisible();
    await page.getByLabel("Area", { exact: true }).fill("");
    await page.getByRole("button", NEXT).click();

    // ── Contact and alerts: all optional, but what is typed is checked ──
    await expect(page.getByRole("heading", { name: "Contact and alerts" })).toBeVisible();
    await page.getByLabel("WhatsApp number (optional)").fill("");
    await page.getByRole("switch", { name: "Show a WhatsApp button on your store page" }).click();
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("Add your WhatsApp number, or turn off the switches below.")).toBeVisible();
    await page.getByLabel("WhatsApp number (optional)").fill("98765 43210");
    await page.getByLabel("Instagram username (optional)").fill("@E2E.Kitchen");
    await page.getByLabel("FSSAI number (optional)").fill("123");
    await page.getByRole("button", NEXT).click();
    await expect(page.getByText("FSSAI number must be exactly 14 digits.")).toBeVisible();
    await page.getByLabel("FSSAI number (optional)").fill("12345678901234");
    await page.getByRole("button", NEXT).click();

    // ── Check and publish: every answer, each with a way back ──
    await expect(page.getByRole("heading", { name: "Check and publish" })).toBeVisible();
    await expect(page.getByText("UPI to", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Pay on delivery", { exact: true })).toBeVisible();
    await expect(page.getByText(/^1 dish$/)).toBeVisible();
    await expect(page.getByText("Order from menu: your menu any time")).toBeVisible();
    await expect(page.getByText("Delivery fee ₹30")).toBeVisible();
    await expect(page.getByText("Delivers to Kondapur")).toBeVisible();
    await expect(page.getByText("WhatsApp 98765 43210, shown on your store page")).toBeVisible();
    await expect(page.getByText("Instagram @e2e.kitchen")).toBeVisible();

    // "Change" opens that step; saving it comes straight back here.
    await page.getByRole("button", { name: "Change Pickup or delivery" }).click();
    await expect(page.getByRole("heading", { name: "Pickup or delivery" })).toBeVisible();
    await page.getByLabel("Delivery fee (₹)").fill("40");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check and publish" })).toBeVisible();
    await expect(page.getByText("Delivery fee ₹40")).toBeVisible();

    await page.getByRole("button", { name: "Publish my store" }).click();

    // Menu orders only, live: the next place is the orders board, and the link is ready to share.
    await expect(page.getByRole("heading", { name: "Your store is live" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to your orders" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();

    const after = (await (await page.request.get("/api/vendor")).json()) as {
      vendor: { slug: string; onboardingDone: boolean; onboardingStep: number | null; settings: Record<string, unknown> };
    };
    expect(after.vendor.onboardingDone).toBe(true);
    expect(after.vendor.onboardingStep).toBeNull();
    expect(after.vendor.settings).toMatchObject({
      publishStorefront: true,
      acceptMenuOrders: true,
      menuFulfilmentMode: "DELIVERY",
      menuDeliveryFeePaise: 4000,
      deliveryAreas: [{ name: "Kondapur", feePaise: 0 }],
      whatsappNumber: "+919876543210",
      acceptWhatsappOrders: false,
      showWhatsappOnStore: true,
      sendWhatsappReceipt: true,
      instagramHandle: "e2e.kitchen",
      fssaiNumber: "12345678901234",
    });

    // The store page is public now.
    await page.goto(`/s/${after.vendor.slug}`);
    await expect(page.getByText("Puran Poli").first()).toBeVisible();

    // A first drop starts from the pickup / delivery answer instead of asking again.
    await page.goto("/drops/new");
    await expect(page.getByRole("radio", { name: "Delivery" })).toBeChecked();
  });

  test("the last step can finish without publishing, and the store stays hidden", async ({ page, request }) => {
    test.setTimeout(120_000);
    const creds = await registerVendor(request, "onb-nopub");
    await signIn(page, creds, "/onboarding");
    await expect(page.getByRole("heading", { name: "Your store", exact: true })).toBeVisible();

    // Steps 1–6 answered through the same endpoints the steps use.
    const patch = (data: Record<string, unknown>) => page.request.patch("/api/vendor", { data });
    expect((await patch({ city: "Pune", state: "Maharashtra", stallType: "HOME_KITCHEN" })).ok()).toBe(true);
    expect((await patch({ upiId: "e2e@okaxis", upiName: "E2E Kitchen", acceptPayOnDelivery: false })).ok()).toBe(true);
    const bulk = await page.request.post("/api/menu/bulk", { data: { items: [{ name: "Modak", priceInPaise: 2500 }] } });
    expect(bulk.ok()).toBe(true);
    expect((await patch({ acceptMenuOrders: false, menuFulfilmentMode: "PICKUP", menuPickupNote: "Gate 2" })).ok()).toBe(true);
    expect((await patch({ onboardingStep: 6 })).ok()).toBe(true);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Check and publish" })).toBeVisible();
    await expect(page.getByText("UPI to e2e@okaxis")).toBeVisible();
    await expect(page.getByText("Pre-orders, each with a cut-off")).toBeVisible();
    await expect(page.getByText("Pickup: Gate 2")).toBeVisible();
    await expect(page.getByText("Nothing added")).toBeVisible();

    await page.getByRole("button", { name: "Finish without publishing" }).click();
    await expect(page.getByRole("heading", { name: "Setup is done" })).toBeVisible();
    await expect(page.getByText(/This link is not public yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your first pre-order" })).toBeVisible();

    const { vendor } = (await (await page.request.get("/api/vendor")).json()) as {
      vendor: { slug: string; onboardingDone: boolean; settings: { publishStorefront: boolean } };
    };
    expect(vendor.onboardingDone).toBe(true);
    expect(vendor.settings.publishStorefront).toBe(false);
    expect((await page.request.get(`/s/${vendor.slug}`)).status()).toBe(404);
  });

  test("Connect Razorpay comes back to setup, and only to setup or Settings", async ({ page, request }) => {
    const creds = await registerVendor(request, "onb-rzp");
    await signIn(page, creds, "/onboarding");
    await page.getByLabel("City").fill("Pune");
    await page.getByLabel("State").fill("Maharashtra");
    await page.getByRole("button", NEXT).click();
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();

    // No Razorpay partner app here, so the connect route answers "unavailable" at once.
    const connect = "/api/vendor/payments/razorpay/connect";
    const location = async (path: string) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(303);
      return new URL(res.headers().location!).pathname + new URL(res.headers().location!).search;
    };
    expect(await location(`${connect}?return=onboarding`)).toBe("/onboarding?razorpay=unavailable");
    expect(await location(connect)).toBe("/settings/payments?razorpay=unavailable");
    expect(await location(`${connect}?return=${encodeURIComponent("https://example.com/")}`)).toBe(
      "/settings/payments?razorpay=unavailable",
    );

    // Coming back opens the payment step with the outcome on it.
    await page.goto("/onboarding?razorpay=unavailable");
    await expect(page.getByRole("heading", { name: "Getting paid" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Connect Razorpay isn't switched on" })).toBeVisible();
  });
});
