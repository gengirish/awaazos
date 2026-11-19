import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { buildDemoFixture, type DemoFixture, type DemoFixtureCategory } from "@/lib/demo-fixture";
import type { MenuSlotRule } from "@/lib/menu-slots";

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
  /** The owner's sign-in, for scenes that film the seller's side (demo/seed/session.ts). */
  email: string;
  password: string;
  /** Item name → MenuItem id (everyday items and the gift). */
  ids: Record<string, string>;
  /** Item name → colour label → ItemVariant id, for items sold by colour (goods fixtures). */
  colours: Record<string, Record<string, string>>;
  /** Weekly pickup / delivery slots, as saved (checkout needs one). */
  slots: MenuSlotRule[];
  /** Item names on the everyday menu, in fixture order. */
  everyday: string[];
  gift: string;
};

/** Emoji the recording browser can't draw (an empty box on Windows 10 Chrome) → one it can. */
const EMOJI_FALLBACK: Record<string, string> = { "🫓": "🥙" };

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
  {
    fssai = false,
    offer = true,
  }: {
    /** Create the fixture's "2+ → free item" plan. False for a scene that films making it. */
    offer?: boolean;
    /**
     * Save a made-up FSSAI number, so "Add your FSSAI number" stays off the seller's
     * screens. It also shows on the store page and receipts, so only seller-side scenes that
     * film neither pass true.
     */
    fssai?: boolean;
  } = {},
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
    const colours: Record<string, Record<string, string>> = {};
    const items = [...f.everyday, f.gift];
    for (const item of items) {
      const res = await page.request.post("/api/menu", {
        data: {
          name: item.name,
          priceInRupees: item.rupees,
          category: item.category,
          description: item.description,
          emoji: EMOJI_FALLBACK[item.emoji] ?? item.emoji,
          // An item sold by colour keeps its stock per colour, below.
          ...(item.stock !== undefined && !item.colours?.length ? { stockQty: item.stock } : {}),
        },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status(), `create "${item.name}"`).toBe(201);
      const { data } = (await res.json()) as { data: { id: string } };
      ids.set(item.name, data.id);
      await seedItemPhotos(data.id, [item.imageUrl]);
      if (item.colours?.length) {
        const put = await page.request.put(`/api/menu/${data.id}/variants`, {
          data: { variants: item.colours.map((c) => ({ label: c.label, ...(c.stock !== undefined ? { stockQty: c.stock } : {}) })) },
          headers: { "Content-Type": "application/json" },
        });
        expect(put.ok(), `colours for "${item.name}": ${await put.text()}`).toBe(true);
        const { data: rows } = (await put.json()) as { data: { id: string; label: string }[] };
        colours[item.name] = Object.fromEntries(rows.map((r) => [r.label, r.id]));
      }
    }

    const settings = await page.request.patch("/api/vendor", {
      data: {
        city: f.city,
        tagline: f.tagline,
        theme: f.theme,
        // On camera on the buyer's pay screen: the kitchen keeps the ID its films show.
        upiId: category === "meals" ? "ammaskitchen@okaxis" : `${f.slug.replace(/-/g, "")}@okaxis`,
        upiName: f.name,
        acceptPayOnDelivery: true,
        publishStorefront: true,
        acceptMenuOrders: true,
        menuFulfilmentMode: f.fulfilment,
        menuDeliveryFeePaise: f.deliveryFeePaise,
        menuPickupNote: f.pickupNote,
        menuSlots: f.slots,
        onboardingDone: true,
        ...(fssai ? { fssaiNumber: "10019022000123" } : {}),
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(settings.ok(), `store settings: ${await settings.text()}`).toBe(true);

    if (offer) await createFixtureOffer(page, f, ids);

    return {
      slug,
      name: f.name,
      email,
      password: E2E_PASSWORD,
      ids: Object.fromEntries(ids),
      colours,
      slots: f.slots,
      everyday: f.everyday.map((i) => i.name),
      gift: f.gift.name,
      accent: THEME_HEX[f.theme] ?? THEME_HEX.orange,
    };
  } finally {
    await ctx.close();
  }
}

/** The fixture's "2+ → free <gift>" plan, on menu orders. */
async function createFixtureOffer(page: Page, f: DemoFixture, ids: Map<string, string>): Promise<void> {
  const res = await page.request.post("/api/offers", {
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
  expect(res.status(), `create the offer: ${await res.text()}`).toBe(201);
}
