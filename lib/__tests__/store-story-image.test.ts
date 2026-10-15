import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Classic JSX runtime in Vitest (vitest.config.ts): the card module needs React global.
(globalThis as { React?: typeof React }).React = React;

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { vendor: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { STORY_MAX_ITEMS } from "@/lib/drop-story-image";
import { STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";
import { loadStoreStory, StoreStoryCard, type StoreStory } from "@/lib/store-story-image";

const card = (s: StoreStory, host: string) => createElement(StoreStoryCard, { story: s, host });

function story(over: Partial<StoreStory> = {}): StoreStory {
  return {
    vendorName: "Ragi Kitchen",
    city: "Hyderabad",
    slug: "ragi-kitchen",
    published: true,
    acceptMenuOrders: true,
    fulfilmentMode: "PICKUP",
    pickupNote: "Gate 2, Kondapur",
    items: [{ name: "Banana bread", priceInPaise: 25000, unit: null }],
    ...over,
  };
}

describe("loadStoreStory", () => {
  beforeEach(() => findUnique.mockReset());

  it("reads only what the storefront shows and never contact fields", async () => {
    findUnique.mockResolvedValue(null);
    expect(await loadStoreStory("v1")).toBeNull();
    const arg = findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "v1" });
    expect(Object.keys(arg.select).sort()).toEqual(["city", "menuItems", "name", "settings", "slug"]);
    expect(arg.select.menuItems.where).toEqual(STOREFRONT_MENU_ITEM_WHERE);
  });

  it("defaults the settings when the row has none", async () => {
    findUnique.mockResolvedValue({ name: "V", city: null, slug: "v", settings: null, menuItems: [] });
    expect(await loadStoreStory("v1")).toMatchObject({ published: false, acceptMenuOrders: false, fulfilmentMode: "PICKUP" });
  });
});

describe("StoreStoryCard", () => {
  it("shows the store, its items, how to get them and the link", () => {
    const html = renderToStaticMarkup(card(story({ items: [{ name: "Ghee", priceInPaise: 120000, unit: "kg" }] }), "awaazos.intelliforge.tech"));
    expect(html).toContain("Now taking orders · Hyderabad");
    expect(html).toContain("Ragi Kitchen");
    expect(html).toContain("Ghee");
    expect(html).toContain("1,200");
    expect(html).toContain("/ kg");
    expect(html).toContain("Tap the link to order");
    expect(html).toContain("Pickup · Gate 2, Kondapur");
    expect(html).toContain("awaazos.intelliforge.tech/s/ragi-kitchen");
  });

  it("is a menu, not an order call, when menu orders are off", () => {
    const html = renderToStaticMarkup(card(story({ acceptMenuOrders: false }), "h"));
    expect(html).toContain("Our menu");
    expect(html).toContain("Tap the link for the menu");
    expect(html).not.toContain("Gate 2");
  });

  it("drops the pickup point for delivery-only stores", () => {
    const html = renderToStaticMarkup(card(story({ fulfilmentMode: "DELIVERY" }), "h"));
    expect(html).toContain("Delivery");
    expect(html).not.toContain("Gate 2");
  });

  it("caps the item list and says how many more", () => {
    const items = Array.from({ length: STORY_MAX_ITEMS + 2 }, (_, i) => ({ name: `Item ${i}`, priceInPaise: 1000, unit: null }));
    const html = renderToStaticMarkup(card(story({ items }), "h"));
    expect(html).not.toContain(`Item ${STORY_MAX_ITEMS}<`);
    expect(html).toContain("and 2 more");
  });
});
