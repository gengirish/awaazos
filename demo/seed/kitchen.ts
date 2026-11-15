import { expect, type APIRequestContext, type Browser } from "@playwright/test";

import { buildDemoFixture, type DemoFixtureCategory } from "@/lib/demo-fixture";

import { CAN_SET_BILLING, seedItemPhotos } from "../../e2e/helpers/billing-db";
import { CONTEXT_OPTIONS, E2E_PASSWORD, signIn } from "../../e2e/helpers/vendor";
import { CITY } from "./cast";

/**
 * A store that looks like a real seller's for the camera: the outreach fixture
 * (lib/demo-fixture.ts) built through the normal API, so it is an ordinary
 * signed-up store, not an `isDemo` one (no "(DEMO)" in its name).
 *
 * Photos are written straight to the local database (`seedItemPhotos`), because
 * uploads need a Vercel Blob token that local runs don't have. That helper
 * refuses anything but a localhost database.
 */

export type SeededStore = {
  slug: string;
  name: string;
  /** Item names on the everyday menu, in fixture order. */
  everyday: string[];
  gift: string;
};

/** "green" → the --primary of [data-theme="green"] in app/globals.css, for the video background. */
export const THEME_HEX: Record<string, string> = {
  orange: "#ea580c",
  green: "#157f3c",
  amber: "#b45309",
  red: "#b91c1c",
  blue: "#1d4ed8",
  purple: "#7e22ce",
};

export async function seedStore(
  browser: Browser,
  request: APIRequestContext,
  category: DemoFixtureCategory = "meals",
): Promise<SeededStore & { accent: string }> {
  expect(CAN_SET_BILLING, "demo seeding needs a local DATABASE_URL and BASE_URL").toBe(true);

  const f = buildDemoFixture({ category, city: CITY });
  const suffix = Math.random().toString(36).slice(2, 6);
  // The handle is never on camera (no address bar), but must be unique per run.
  const slug = `${f.slug}-${suffix}`.slice(0, 40);
  const email = `e2e-demo-${suffix}-${Date.now()}@example.com`;

  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      password: E2E_PASSWORD,
      name: "Demo Owner",
      stallName: f.name,
      stallType: f.stallType,
      ...(f.stallTypeOther ? { stallTypeOther: f.stallTypeOther } : {}),
      storeHandle: slug,
      phone: "+919199990001",
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.status(), "register the demo store").toBe(201);

  // The seller's session lives in its own context: it is never filmed.
  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await ctx.newPage();
    await signIn(page, { email, password: E2E_PASSWORD, stallName: f.name }, "/menu");

    const ids = new Map<string, string>();
    const items = [...f.everyday, f.gift];
    for (const item of items) {
      const res = await page.request.post("/api/menu", {
        data: {
          name: item.name,
          priceInRupees: item.rupees,
          category: item.category,
          description: item.description,
          emoji: item.emoji,
        },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status(), `create "${item.name}"`).toBe(201);
      const { data } = (await res.json()) as { data: { id: string } };
      ids.set(item.name, data.id);
      await seedItemPhotos(data.id, [item.imageUrl]);
    }

    const settings = await page.request.patch("/api/vendor", {
      data: {
        city: f.city,
        tagline: f.tagline,
        theme: f.theme,
        upiId: "ammaskitchen@okaxis",
        upiName: f.name,
        acceptPayOnDelivery: true,
        publishStorefront: true,
        acceptMenuOrders: true,
        menuFulfilmentMode: f.fulfilment,
        menuDeliveryFeePaise: f.deliveryFeePaise,
        menuPickupNote: f.pickupNote,
        menuSlots: f.slots,
        onboardingDone: true,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(settings.ok(), `store settings: ${await settings.text()}`).toBe(true);

    const offer = await page.request.post("/api/offers", {
      data: {
        name: f.offer.name,
        description: f.offer.description,
        eligibility: "ITEMS",
        eligibleItemIds: f.everyday.map((i) => ids.get(i.name)),
        minQty: f.offer.minQty,
        discountType: "FREE_ITEM",
        freeItemId: ids.get(f.gift.name),
        freeItemQty: 1,
        onMenuOrders: true,
        onDrops: false,
        onPos: false,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(offer.status(), `create the offer: ${await offer.text()}`).toBe(201);

    return {
      slug,
      name: f.name,
      everyday: f.everyday.map((i) => i.name),
      gift: f.gift.name,
      accent: THEME_HEX[f.theme] ?? THEME_HEX.orange,
    };
  } finally {
    await ctx.close();
  }
}
