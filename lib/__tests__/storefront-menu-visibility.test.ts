import { describe, expect, it, vi } from "vitest";

// Pure functions only — keep Prisma/env/KV out of the unit run.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpDropOrderSignal: vi.fn() }));
vi.mock("@/lib/push", () => ({ notifyVendorInBackground: vi.fn(), newOrderPayload: vi.fn() }));

import type { DropStatus } from "@prisma/client";

import { effectiveDropStatus } from "@/lib/drops";
import {
  STOREFRONT_MENU_ITEM_WHERE,
  everydayMenuHiddenByDrops,
  orderErrorMessage,
  type MenuHidingDrop,
} from "@/lib/storefront-order";

const NOW = new Date("2026-10-07T06:30:00Z"); // 12:00 IST
const H = 60 * 60 * 1000;
const at = (offsetH: number) => new Date(NOW.getTime() + offsetH * H);

function drop(over: Partial<MenuHidingDrop> = {}): MenuHidingDrop {
  return { status: "OPEN", opensAt: null, closesAt: at(3), showEverydayMenu: false, ...over };
}

describe("everydayMenuHiddenByDrops", () => {
  it("no drops → menu shows", () => {
    expect(everydayMenuHiddenByDrops([], NOW)).toBe(false);
  });

  it("an open drop with showEverydayMenu=false hides the menu", () => {
    expect(everydayMenuHiddenByDrops([drop()], NOW)).toBe(true);
    expect(everydayMenuHiddenByDrops([drop({ opensAt: at(-1) })], NOW)).toBe(true);
  });

  it("an open drop with showEverydayMenu=true keeps the menu", () => {
    expect(everydayMenuHiddenByDrops([drop({ showEverydayMenu: true })], NOW)).toBe(false);
  });

  it("a scheduled drop (opensAt in the future) does not hide the menu", () => {
    expect(everydayMenuHiddenByDrops([drop({ opensAt: at(1) })], NOW)).toBe(false);
  });

  it("a drop past its cut-off does not hide the menu (closesAt is exclusive)", () => {
    expect(everydayMenuHiddenByDrops([drop({ closesAt: at(-1) })], NOW)).toBe(false);
    expect(everydayMenuHiddenByDrops([drop({ closesAt: NOW })], NOW)).toBe(false);
  });

  it("opensAt is inclusive", () => {
    expect(everydayMenuHiddenByDrops([drop({ opensAt: NOW })], NOW)).toBe(true);
  });

  it("non-OPEN stored statuses never hide the menu", () => {
    for (const status of ["DRAFT", "CLOSED", "FROZEN", "FULFILLED"]) {
      expect(everydayMenuHiddenByDrops([drop({ status })], NOW)).toBe(false);
    }
  });

  it("any one hiding drop wins over drops that show the menu", () => {
    expect(
      everydayMenuHiddenByDrops([drop({ showEverydayMenu: true }), drop({ closesAt: at(5) })], NOW),
    ).toBe(true);
    // ...but a scheduled/closed hider doesn't count.
    expect(
      everydayMenuHiddenByDrops(
        [drop({ showEverydayMenu: true }), drop({ opensAt: at(2) }), drop({ closesAt: at(-2) })],
        NOW,
      ),
    ).toBe(false);
  });

  it("matches effectiveDropStatus(...) === 'OPEN' for every stored status and time window", () => {
    const statuses: DropStatus[] = ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"];
    const opens = [null, at(-2), NOW, at(2)];
    const closes = [at(-1), NOW, at(1), at(4)];
    for (const status of statuses)
      for (const opensAt of opens)
        for (const closesAt of closes) {
          const d = drop({ status, opensAt, closesAt });
          const expected = effectiveDropStatus({ status, opensAt, closesAt }, NOW) === "OPEN";
          expect(everydayMenuHiddenByDrops([d], NOW)).toBe(expected);
        }
  });
});

describe("storefront menu item filter", () => {
  it("offers only available items that are shown online", () => {
    expect(STOREFRONT_MENU_ITEM_WHERE).toEqual({ isAvailable: true, showOnline: true });
  });
});

describe("menu_paused_for_drop copy", () => {
  it("points the buyer at the drop", () => {
    expect(orderErrorMessage({ error: "menu_paused_for_drop" })).toBe(
      "The everyday menu is paused while today's special menu is open. Order from the drop above.",
    );
  });
});
