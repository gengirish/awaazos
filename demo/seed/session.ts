import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { upcomingMenuSlots } from "@/lib/menu-slots";

import { signIn } from "../../e2e/helpers/vendor";
import type { SeededStore } from "./kitchen";

/**
 * Shared set-up for scenes beyond C1: a quiet phone, the seller's own phone,
 * and orders placed by made-up buyers through the public API (never filmed).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Hide every one-time card that would sit between the camera and the flow:
 * cookie banner, install hints, the orders board's banner slot. Call before the
 * first navigation. Keys from lib/cookie-pref.ts, lib/install-prompt.ts,
 * lib/store-app.ts, lib/orders-banner.ts and components/** (*_SNOOZE_KEY).
 */
export async function quietPhone(page: Page, slug?: string): Promise<void> {
  await page.addInitScript((storeSlug: string | null) => {
    try {
      const now = String(Date.now());
      const set = (k: string, v: string) => localStorage.setItem(k, v);
      set("awz_cookie_pref_v1", "accepted");
      set("awz_install_hint_dismissed_v1", "1");
      if (storeSlug) set(`awz_store_install_dismissed_v1:${storeSlug}`, "1");
      set("awz_setup_reminder_snoozed", now);
      set("awz_owner_survey_prompt_hidden", now);
      set("awz_referral_prompt_hidden", now);
      for (const kind of ["test_items", "no_tagline", "test_named_items"]) set(`awz_store_polish_dismissed_${kind}`, now);
      sessionStorage.setItem("awz_owner_survey_seen", "1");
    } catch {}
  }, slug ?? null);
}

/** Sign the filmed page in as the store's owner and open `path` (before Director.start). */
export async function sellerSignIn(page: Page, store: SeededStore, path = "/orders"): Promise<void> {
  await quietPhone(page, store.slug);
  await signIn(page, { email: store.email, password: store.password, stallName: store.name }, path);
  if (new URL(page.url()).pathname !== path) await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export type PlacedOrder = { orderToken: string; billNumber: string; totalPaise: number };

/** A guest buyer's menu order through the public API, at the store's first open slot. */
export async function placeMenuOrder(
  request: APIRequestContext,
  store: SeededStore,
  {
    buyer,
    items,
    delivery = false,
    paymentMethod = "UPI",
  }: {
    buyer: { name: string; mobile: string };
    /** `colour` picks the item's colour (goods fixtures); required for an item sold by colour. */
    items: { name: string; qty: number; colour?: string }[];
    delivery?: boolean;
    paymentMethod?: "UPI" | "CASH";
  },
): Promise<PlacedOrder> {
  const slot = upcomingMenuSlots(store.slots)[0];
  const res = await request.post(`/api/s/${store.slug}/menu-orders`, {
    data: {
      items: items.map((i) => ({
        menuItemId: store.ids[i.name],
        qty: i.qty,
        ...(i.colour ? { variantId: store.colours[i.name]?.[i.colour] } : {}),
      })),
      customerName: buyer.name,
      customerPhone: `+91${buyer.mobile.replace(/\D/g, "").slice(-10)}`,
      fulfilmentType: delivery ? "DELIVERY" : "PICKUP",
      ...(delivery
        ? { deliveryAddress: "Flat 304, Lakeview Residency", deliveryLocality: "Yelahanka New Town", deliveryLandmark: "Near the post office" }
        : {}),
      ...(slot ? { slotStart: slot.key } : {}),
      paymentMethod,
    },
    headers: JSON_HEADERS,
  });
  expect(res.status(), `place a demo order: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: PlacedOrder }).data;
}

/** The buyer's "I've paid" claim on an order (optionally with a UTR). */
export async function claimPaid(request: APIRequestContext, store: SeededStore, order: PlacedOrder, utr?: string): Promise<void> {
  const res = await request.post(`/api/s/${store.slug}/orders/${order.orderToken}/utr`, {
    data: utr ? { upiRef: utr } : {},
    headers: JSON_HEADERS,
  });
  expect(res.ok(), `claim payment: ${await res.text()}`).toBe(true);
}

/**
 * Give the store a (made-up) FSSAI number, so the "Add your FSSAI number" nudge
 * isn't on the seller's screens. Needs the page signed in (sellerSignIn); reloads it.
 */
export async function setDemoFssai(page: Page): Promise<void> {
  const res = await page.request.patch("/api/vendor", { data: { fssaiNumber: "10019022000123" }, headers: JSON_HEADERS });
  expect(res.ok(), `set the FSSAI number: ${await res.text()}`).toBe(true);
  await page.reload();
  await page.waitForLoadState("networkidle");
}
