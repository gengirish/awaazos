import * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The storefront OG card's variant choice (app/s/[slug]/opengraph-image.tsx).
 * Rendered through a stubbed ImageResponse because next/og's font loader
 * can't resolve its bundled font path on Windows outside a real deploy.
 */
const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { vendor: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock("@/lib/drops-signal", () => ({ bumpDropOrderSignal: vi.fn() }));
vi.mock("@/lib/push", () => ({ notifyVendorInBackground: vi.fn(), newOrderPayload: vi.fn() }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    el: ReactElement;
    constructor(el: ReactElement) {
      this.el = el;
    }
  },
}));

import Image from "@/app/s/[slug]/opengraph-image";

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
  const res = (await Image({ params: { slug: "asha" } })) as unknown as { el: ReactElement };
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
    expect(args.select.menuItems.where).toEqual({ isAvailable: true, showOnline: true });
    expect(args.select.drops.select.showEverydayMenu).toBe(true);
  });

  it("no drop → menu variant with online items", async () => {
    findFirst.mockResolvedValue(vendor([]));
    const html = await card();
    expect(html).toContain("Order from the menu");
    expect(html).toContain("Online Samosa");
  });

  it("open drop hiding the menu → drop variant, never the menu", async () => {
    findFirst.mockResolvedValue(vendor([drop()]));
    const html = await card();
    expect(html).toContain("Diwali Sweets");
    expect(html).not.toContain("Online Samosa");
    expect(html).not.toContain("Order from the menu");
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

  it("menu ordering off, no drop → See the menu", async () => {
    findFirst.mockResolvedValue({ ...vendor([]), settings: { acceptMenuOrders: false, menuFulfilmentMode: "PICKUP" } });
    const html = await card();
    expect(html).toContain("See the menu");
  });
});
