import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Classic JSX runtime in Vitest (vitest.config.ts): the card module needs React global.
(globalThis as { React?: typeof React }).React = React;

const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { drop: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { DropStoryCard, loadDropStory, STORY_MAX_ITEMS, storyOrderUrl, type DropStory } from "@/lib/drop-story-image";

const H = 60 * 60 * 1000;

const card = (s: DropStory, host: string) => createElement(DropStoryCard, { story: s, host });

function story(over: Partial<DropStory> = {}): DropStory {
  const now = Date.now();
  return {
    vendorName: "Ragi Kitchen",
    city: "Hyderabad",
    slug: "ragi-kitchen",
    title: "Saturday Bakes",
    closesAt: new Date(now + 4 * H),
    fulfilmentMode: "DELIVERY",
    fulfilmentStartsAt: new Date(now + 20 * H),
    fulfilmentEndsAt: new Date(now + 22 * H),
    items: [{ name: "Banana bread", priceInPaise: 25000 }],
    ...over,
  };
}

describe("loadDropStory", () => {
  beforeEach(() => findFirst.mockReset());

  it("scopes the lookup to the vendor and never selects contact fields", async () => {
    findFirst.mockResolvedValue(null);
    expect(await loadDropStory("d1", "v1")).toBeNull();
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "d1", vendorId: "v1" });
    expect(Object.keys(arg.select.vendor.select).sort()).toEqual(["city", "name", "slug"]);
  });

  it("flattens items to name + price", async () => {
    findFirst.mockResolvedValue({
      title: "T",
      closesAt: new Date(),
      fulfilmentMode: "PICKUP",
      fulfilmentStartsAt: new Date(),
      fulfilmentEndsAt: new Date(),
      vendor: { name: "V", city: null, slug: "v" },
      items: [{ priceInPaise: 9900, menuItem: { name: "Thepla" } }],
    });
    const s = await loadDropStory("d1", "v1");
    expect(s?.items).toEqual([{ name: "Thepla", priceInPaise: 9900 }]);
    expect(s?.slug).toBe("v");
  });
});

describe("DropStoryCard", () => {
  it("shows the drop, cut-off, fulfilment and order link", () => {
    const html = renderToStaticMarkup(card(story(), "awaazos.intelliforge.tech"));
    expect(html).toContain("Ragi Kitchen · Hyderabad");
    expect(html).toContain("Saturday Bakes");
    expect(html).toContain("Banana bread");
    expect(html).toContain("250");
    expect(html).toMatch(/Order by [^<]+, \d{1,2}(:\d{2})?/);
    expect(html).toContain("Delivery ");
    expect(html).toContain("awaazos.intelliforge.tech/s/ragi-kitchen");
  });

  it("caps the item list and says how many more", () => {
    const items = Array.from({ length: STORY_MAX_ITEMS + 3 }, (_, i) => ({ name: `Item ${i}`, priceInPaise: 1000 }));
    const html = renderToStaticMarkup(card(story({ items }), "h"));
    expect(html).toContain(`Item ${STORY_MAX_ITEMS - 1}`);
    expect(html).not.toContain(`Item ${STORY_MAX_ITEMS}<`);
    expect(html).toContain("and 3 more");
  });
});

describe("storyOrderUrl", () => {
  it("drops the scheme and encodes the slug", () => {
    expect(storyOrderUrl("example.com", "a b")).toBe("example.com/s/a%20b");
  });
});
