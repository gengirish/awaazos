import { describe, expect, it } from "vitest";

import type { MenuItemForParse } from "@/lib/anthropic";
import {
  alignParsedItemsToMenu,
  rescueMatchFromTranscript,
} from "@/lib/parse-order-align";

const MENU: MenuItemForParse[] = [
  {
    id: "mi_lassi",
    name: "Sweet Lassi",
    aliases: ["lassi", "meethi lassi"],
    priceInPaise: 4000,
  },
  {
    id: "mi_panna",
    name: "Nimbu Panna",
    aliases: ["nimbu pani", "nimbu panna", "shikanji"],
    priceInPaise: 3000,
  },
  {
    id: "mi_sharbat",
    name: "Mohabbat Sharbat",
    aliases: ["mohabbat sharbat", "sharbat"],
    priceInPaise: 3500,
  },
  {
    id: "mi_rasgulla",
    name: "Rasgulla",
    aliases: ["rasgulla", "rasgula"],
    priceInPaise: 4500,
  },
];

describe("alignParsedItemsToMenu", () => {
  it("drops forged menuItemId and uses authoritative menu price", () => {
    const aligned = alignParsedItemsToMenu(MENU, [
      {
        menuItemId: "mi_lassi",
        name: "Wrong Name",
        priceInPaise: 1,
        qty: 2,
      },
      {
        menuItemId: "forged-id",
        name: "Hack",
        priceInPaise: 999,
        qty: 1,
      },
    ]);
    expect(aligned).toEqual([
      {
        menuItemId: "mi_lassi",
        name: "Sweet Lassi",
        priceInPaise: 4000,
        qty: 2,
      },
    ]);
  });
});

describe("rescueMatchFromTranscript", () => {
  it('rescues "Less Bill." → Lassi', () => {
    const r = rescueMatchFromTranscript(MENU, "Less Bill.");
    expect(r.items).toEqual([
      {
        menuItemId: "mi_lassi",
        name: "Sweet Lassi",
        priceInPaise: 4000,
        qty: 1,
      },
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it('rescues "Hum ka panna." → Nimbu Panna', () => {
    const r = rescueMatchFromTranscript(MENU, "Hum ka panna.");
    expect(r.items[0]?.menuItemId).toBe("mi_panna");
    expect(r.items[0]?.qty).toBe(1);
  });

  it('rescues "Mohabbatein Sharbat." → Mohabbat Sharbat', () => {
    const r = rescueMatchFromTranscript(MENU, "Mohabbatein Sharbat.");
    expect(r.items[0]?.menuItemId).toBe("mi_sharbat");
  });

  it("ignores plate classifier and keeps qty for close match", () => {
    const r = rescueMatchFromTranscript(MENU, "2 plates lassi");
    expect(r.items[0]?.menuItemId).toBe("mi_lassi");
    expect(r.items[0]?.qty).toBe(2);
  });
});
