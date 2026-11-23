import * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The storefront OG card's variant choice (app/s/[slug]/share-card/store-card.tsx).
 * Rendered through a stubbed ImageResponse because next/og's font loader
 * can't resolve its bundled font path on Windows outside a real deploy.
 */
const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { vendor: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock("@/lib/drops-signal", () => ({ bumpOrderSignal: vi.fn() }));
vi.mock("@/lib/push", () => ({ notifyVendorInBackground: vi.fn(), newOrderPayload: vi.fn() }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    el: ReactElement;
    constructor(el: ReactElement) {
      this.el = el;
    }
  },
}));

import { dropShareCard } from "@/app/s/[slug]/preorder/[dropId]/share-card/drop-card";
import { storeShareCard } from "@/app/s/[slug]/share-card/store-card";

const H = 60 * 60 * 1000;

function drop(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    title: "Diwali Sweets",
    status: "OPEN",
    opensAt: null,
    closesAt: new Date(now + 4 * H),
    fulfilmentMode: "PICKUP",
    fulfilmentStartsAt: new Date(now + 20 * H),
    fulfilmentEndsAt: new Date(now + 22 * H),
    showEverydayMenu: false,
    items: [{ priceInPaise: 9900, menuItem: { name: "Kaju Katli" } }],
    _count: { items: 1 },
    ...over,
  };
}

function vendor(drops: unknown[]) {
  return {
    id: "v1",
    name: "Asha Kitchen",
    city: "Pune",
    settings: { acceptMenuOrders: true, menuFulfilmentMode: "PICKUP" },
    menuItems: [{ name: "Online Samosa", priceInPaise: 2000 }],
    drops,
  };
}

async function card(): Promise<string> {
  const res = (await storeShareCard("asha")) as unknown as { el: ReactElement };
  return renderToStaticMarkup(res.el);
}

// Vitest compiles the route's JSX with the classic runtime.
(globalThis as { React?: typeof React }).React = React;

describe("storefront OG card", () => {
  beforeEach(() => findFirst.mockReset());

  it("queries only items offered online and reads showEverydayMenu", async () => {
    findFirst.mockResolvedValue(vendor([]));
    await card();
    const args = findFirst.mock.calls[0]![0] as {
      select: { menuItems: { where: unknown }; drops: { select: Record<string, unknown> } };
    };
    expect(args.select.menuItems.where).toEqual({ isAvailable: true, showOnline: true, archivedAt: null });
    expect(args.select.drops.select.showEverydayMenu).toBe(true);
  });

  it("no drop → menu variant with online items", async () => {
    findFirst.mockResolvedValue(vendor([]));
    const html = await card();
    expect(html).toContain("Order now");
    expect(html).toContain("Online Samosa");
  });

  it("open drop hiding the menu → drop variant, never the menu", async () => {
    findFirst.mockResolvedValue(vendor([drop()]));
    const html = await card();
    expect(html).toContain("Diwali Sweets");
    expect(html).not.toContain("Online Samosa");
    expect(html).not.toContain("Order now");
  });

  it("open drop showing the menu → still the drop card (drops take priority)", async () => {
    findFirst.mockResolvedValue(vendor([drop({ showEverydayMenu: true })]));
    const html = await card();
    expect(html).toContain("Diwali Sweets");
  });

  it("only a scheduled drop → the scheduled drop card", async () => {
    findFirst.mockResolvedValue(vendor([drop({ opensAt: new Date(Date.now() + 2 * H) })]));
    const html = await card();
    expect(html).toContain("Diwali Sweets");
  });

  it("menu ordering off, no drop → Browse the store", async () => {
    findFirst.mockResolvedValue({ ...vendor([]), settings: { acceptMenuOrders: false, menuFulfilmentMode: "PICKUP" } });
    const html = await card();
    expect(html).toContain("Browse the store");
  });
});

describe("storefront OG card: more items than rows", () => {
  beforeEach(() => findFirst.mockReset());

  it("says how many more items the drop has", async () => {
    findFirst.mockResolvedValue(vendor([drop({ _count: { items: 7 } })]));
    expect(await card()).toContain("+6 more");
  });
});

/** The pre-order link's card (app/s/[slug]/preorder/[dropId]/share-card/drop-card.tsx). */
async function preorderCard(dropId = "d1"): Promise<string> {
  const res = (await dropShareCard("asha", dropId)) as unknown as { el: ReactElement };
  return renderToStaticMarkup(res.el);
}

describe("pre-order link OG card", () => {
  beforeEach(() => findFirst.mockReset());

  it("reads that drop only, with the slug's vendor and the page's filter", async () => {
    findFirst.mockResolvedValue({ ...vendor([drop({ id: "d1", title: "Festive Boxes" })]), menuItems: undefined });
    const html = await preorderCard("d1");
    expect(html).toContain("Festive Boxes");
    expect(html).toContain("Kaju Katli");
    expect(html).not.toContain("Online Samosa");
    const args = findFirst.mock.calls[0]![0] as {
      where: { slug: string; settings: unknown };
      select: { drops: { where: { id: string; status: string } }; menuItems?: unknown };
    };
    expect(args.where.slug).toBe("asha");
    expect(args.where.settings).toEqual({ is: { publishStorefront: true } });
    expect(args.select.drops.where).toMatchObject({ id: "d1", status: "OPEN" });
    expect(args.select.menuItems).toBeUndefined();
  });

  it("a drop just past its cut-off says orders are closed", async () => {
    findFirst.mockResolvedValue(vendor([drop({ id: "d1", closesAt: new Date(Date.now() - H) })]));
    const html = await preorderCard("d1");
    expect(html).toContain("Orders closed");
    expect(html).not.toContain("Order by");
  });

  it("a drop the page wouldn't show → the store's own card", async () => {
    // First read: the store, without that drop. Second: the store card's own read.
    findFirst.mockResolvedValueOnce(vendor([])).mockResolvedValueOnce(vendor([]));
    const html = await preorderCard("draft-or-other-store");
    expect(html).toContain("Online Samosa");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("an unpublished store → the generic card, nothing from the slug", async () => {
    findFirst.mockResolvedValue(null);
    const html = await preorderCard("d1");
    expect(html).toContain("Order online from local stores");
    expect(html).not.toContain("Asha");
  });
});
