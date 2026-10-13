import { describe, expect, it } from "vitest";

import {
  applyOffers,
  discountLabel,
  formatPercentBps,
  offerIsLive,
  offerNudgeText,
  offerSummary,
  resolveOffers,
  type OfferLine,
  type OfferRule,
} from "@/lib/offers";

// The Flavours of Millets: five quiches, two of them paneer, plus a Bhel Puri
// that no plan covers.
const MENU = [
  { id: "q_pcc", name: "Potato Corn Capsicum", priceInPaise: 5500, tags: ["quiche"] },
  { id: "q_rbz", name: "Raw Banana Corn Zucchini", priceInPaise: 6500, tags: ["Quiche"] },
  { id: "q_pcz", name: "Paneer Carrot Zucchini", priceInPaise: 10000, tags: ["quiche", "paneer"] },
  { id: "q_pbz", name: "Paneer Broccoli Zucchini", priceInPaise: 11000, tags: ["quiche", " Paneer "] },
  { id: "q_psp", name: "Potato Spinach Peas", priceInPaise: 6000, tags: ["quiche"] },
  { id: "bhel", name: "Bhel Puri", priceInPaise: 4000, tags: ["snacks"] },
] as const;

const NOW = new Date("2026-10-13T06:00:00Z");

function rule(over: Partial<OfferRule> & Pick<OfferRule, "id" | "name">): OfferRule {
  return {
    description: null,
    eligibility: "TAG",
    eligibleItemIds: [],
    eligibleTag: "quiche",
    minQty: 4,
    requiredTag: "paneer",
    requiredTagQty: 1,
    discountType: "PERCENT",
    percentBps: 1000,
    onMenuOrders: true,
    onDrops: true,
    onPos: true,
    dropIds: [],
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

const WEEKLY = rule({ id: "weekly", name: "Weekly Plan" });
const FAMILY = rule({
  id: "family",
  name: "Family Weekly Plan",
  minQty: 6,
  requiredTagQty: 2,
  percentBps: 1200,
  createdAt: new Date("2026-10-02T00:00:00Z"),
});

function offers(rules: OfferRule[] = [WEEKLY, FAMILY], channel: "MENU" | "DROP" | "POS" = "MENU") {
  return resolveOffers(rules, MENU, { channel, now: NOW });
}

function cart(qtyById: Record<string, number>): OfferLine[] {
  return Object.entries(qtyById).map(([id, qty]) => ({
    key: id,
    menuItemId: id,
    priceInPaise: MENU.find((m) => m.id === id)!.priceInPaise,
    qty,
  }));
}

describe("applyOffers — the quiche plans", () => {
  it("4 quiches incl. 1 paneer → 10% off the eligible lines", () => {
    const r = applyOffers(cart({ q_pcc: 1, q_rbz: 1, q_pcz: 1, q_psp: 1 }), offers());
    expect(r.subtotalPaise).toBe(28000);
    expect(r.discountTotalPaise).toBe(2800);
    expect(r.totalPaise).toBe(25200);
    expect(r.discounts).toEqual([{ offerId: "weekly", name: "Weekly Plan", percentBps: 1000, discountPaise: 2800 }]);
    expect(r.lines.map((l) => l.discountPaise)).toEqual([550, 650, 1000, 600]);
  });

  it("4 non-paneer quiches → no discount, nudge to add a paneer quiche", () => {
    const r = applyOffers(cart({ q_pcc: 2, q_rbz: 1, q_psp: 1 }), offers());
    expect(r.discountTotalPaise).toBe(0);
    expect(r.discounts).toEqual([]);
    expect(r.nudge).toMatchObject({ offerId: "weekly", missingQty: 1, missingRequiredQty: 1 });
    expect(offerNudgeText(r.nudge!)).toBe("Add 1 paneer quiche item to unlock 10% off (Weekly Plan)");
  });

  it("3 quiches incl. paneer → no discount, nudge to add 1 more", () => {
    const r = applyOffers(cart({ q_pcc: 1, q_pcz: 1, q_psp: 1 }), offers());
    expect(r.discountTotalPaise).toBe(0);
    expect(r.nudge).toMatchObject({ offerId: "weekly", missingQty: 1, missingRequiredQty: 0 });
    expect(offerNudgeText(r.nudge!)).toBe("Add 1 more quiche item to unlock 10% off (Weekly Plan)");
  });

  it("6 quiches incl. 2 paneer → Family 12%, never 10% + 12%", () => {
    const r = applyOffers(cart({ q_pcc: 2, q_rbz: 1, q_pcz: 1, q_pbz: 1, q_psp: 1 }), offers());
    // 110 + 65 + 100 + 110 + 60 = ₹445
    expect(r.subtotalPaise).toBe(44500);
    expect(r.discounts).toHaveLength(1);
    expect(r.discounts[0]).toMatchObject({ offerId: "family", percentBps: 1200, discountPaise: 5340 });
    expect(r.totalPaise).toBe(39160);
    expect(r.nudge).toBeNull();
  });

  it("6 quiches incl. 1 paneer → Weekly 10% applies, nudge for Family", () => {
    const r = applyOffers(cart({ q_pcc: 2, q_rbz: 2, q_pcz: 1, q_psp: 1 }), offers());
    expect(r.discounts[0]).toMatchObject({ offerId: "weekly", percentBps: 1000 });
    expect(r.discountTotalPaise).toBe(Math.floor((r.subtotalPaise * 1000) / 10_000));
    expect(r.nudge).toMatchObject({ offerId: "family", missingQty: 1, missingRequiredQty: 1 });
    expect(offerNudgeText(r.nudge!)).toBe("Add 1 paneer quiche item to unlock 12% off (Family Weekly Plan)");
  });

  it("mixed cart → the discount applies only to the quiches", () => {
    const r = applyOffers(cart({ q_pcc: 1, q_rbz: 1, q_pcz: 1, q_psp: 1, bhel: 3 }), offers());
    expect(r.subtotalPaise).toBe(28000 + 12000);
    expect(r.discountTotalPaise).toBe(2800);
    expect(r.lines.find((l) => l.key === "bhel")!.discountPaise).toBe(0);
    expect(r.totalPaise).toBe(37200);
  });

  it("Bhel Puri does not count toward the minimum quantity", () => {
    const r = applyOffers(cart({ q_pcc: 1, q_pcz: 1, q_psp: 1, bhel: 5 }), offers());
    expect(r.discountTotalPaise).toBe(0);
  });

  it("a paneer item outside the offer does not unlock it", () => {
    const menu = [...MENU, { id: "tikka", name: "Paneer Tikka", priceInPaise: 9000, tags: ["paneer"] }];
    const resolved = resolveOffers([WEEKLY], menu, { channel: "MENU", now: NOW });
    const lines: OfferLine[] = [
      ...cart({ q_pcc: 2, q_rbz: 1, q_psp: 1 }),
      { key: "tikka", menuItemId: "tikka", priceInPaise: 9000, qty: 1 },
    ];
    expect(applyOffers(lines, resolved).discountTotalPaise).toBe(0);
  });

  it("inactive, expired and not-yet-started offers are ignored", () => {
    const lines = cart({ q_pcc: 1, q_rbz: 1, q_pcz: 1, q_psp: 1 });
    const dead = [
      rule({ id: "off", name: "Off", isActive: false }),
      rule({ id: "old", name: "Old", endsAt: new Date("2026-10-12T00:00:00Z") }),
      rule({ id: "soon", name: "Soon", startsAt: new Date("2026-10-14T00:00:00Z") }),
      rule({ id: "bundle", name: "Bundle", discountType: "BUNDLE_PRICE" }),
    ];
    expect(offers(dead)).toEqual([]);
    const r = applyOffers(lines, offers(dead));
    expect(r.discountTotalPaise).toBe(0);
    expect(r.nudge).toBeNull();
    expect(r.totalPaise).toBe(28000);
  });

  it("an offer ends at endsAt, not after it", () => {
    const o = rule({ id: "x", name: "X", endsAt: NOW });
    expect(offerIsLive(o, new Date(NOW.getTime() - 1))).toBe(true);
    expect(offerIsLive(o, NOW)).toBe(false);
  });
});

describe("applyOffers — scope, ties and rounding", () => {
  it("respects the channel toggles and drop attachment", () => {
    const posOnly = rule({ id: "pos", name: "Counter", onMenuOrders: false, onDrops: false });
    const oneDrop = rule({ id: "drop", name: "Saturday", dropIds: ["d1"] });
    expect(offers([posOnly], "MENU")).toHaveLength(0);
    expect(offers([posOnly], "POS")).toHaveLength(1);
    const forDrop = (dropId: string) =>
      resolveOffers([oneDrop], MENU, { channel: "DROP", dropId, now: NOW }).map((o) => o.id);
    expect(forDrop("d1")).toEqual(["drop"]);
    expect(forDrop("d2")).toEqual([]);
  });

  it("an ALL offer covers every line; an ITEMS offer only its ids", () => {
    const all = rule({ id: "all", name: "All", eligibility: "ALL", eligibleTag: null, requiredTag: null, requiredTagQty: 0, minQty: 2 });
    const r = applyOffers(cart({ q_pcc: 1, bhel: 1 }), offers([all]));
    expect(r.discountTotalPaise).toBe(950);

    const picked = rule({
      id: "items",
      name: "Picked",
      eligibility: "ITEMS",
      eligibleItemIds: ["bhel"],
      eligibleTag: null,
      requiredTag: null,
      requiredTagQty: 0,
      minQty: 2,
    });
    const r2 = applyOffers(cart({ q_pcc: 5, bhel: 2 }), offers([picked]));
    expect(r2.discountTotalPaise).toBe(800);
  });

  it("the larger discount wins even at a lower percentage", () => {
    const narrow = rule({
      id: "narrow",
      name: "Bhel 20%",
      eligibility: "ITEMS",
      eligibleItemIds: ["bhel"],
      eligibleTag: null,
      requiredTag: null,
      requiredTagQty: 0,
      minQty: 1,
      percentBps: 2000,
    });
    const r = applyOffers(cart({ q_pcc: 1, q_rbz: 1, q_pcz: 1, q_psp: 1, bhel: 1 }), offers([narrow, WEEKLY]));
    // 20% of ₹40 = ₹8; 10% of ₹280 = ₹28.
    expect(r.discounts[0]!.offerId).toBe("weekly");
  });

  it("ties go to the higher minimum, then the older offer", () => {
    const a = rule({ id: "a", name: "A", minQty: 2 });
    const b = rule({ id: "b", name: "B", minQty: 4, createdAt: new Date("2026-10-05T00:00:00Z") });
    const c = rule({ id: "c", name: "C", minQty: 4, createdAt: new Date("2026-10-06T00:00:00Z") });
    const r = applyOffers(cart({ q_pcc: 3, q_pcz: 1 }), offers([c, a, b]));
    expect(r.discounts[0]!.offerId).toBe("b");
  });

  it("rounds the discount down and splits it across lines exactly", () => {
    const odd = rule({ id: "odd", name: "Odd", eligibility: "ALL", eligibleTag: null, requiredTag: null, requiredTagQty: 0, minQty: 3, percentBps: 1250 });
    const lines: OfferLine[] = [
      { key: "a", menuItemId: "a", priceInPaise: 3333, qty: 1 },
      { key: "b", menuItemId: "b", priceInPaise: 3333, qty: 1 },
      { key: "c", menuItemId: "c", priceInPaise: 3335, qty: 1 },
    ];
    const r = applyOffers(lines, resolveOffers([odd], [], { channel: "POS", now: NOW }));
    // 12.5% of 10001 paise = 1250.125 → 1250.
    expect(r.discountTotalPaise).toBe(1250);
    expect(r.lines.reduce((s, l) => s + l.discountPaise, 0)).toBe(1250);
    for (const l of r.lines) expect(Number.isInteger(l.discountPaise)).toBe(true);
  });

  it("no offers, or an empty cart, is a plain total", () => {
    expect(applyOffers(cart({ bhel: 2 }), [])).toMatchObject({ subtotalPaise: 8000, discountTotalPaise: 0, totalPaise: 8000, nudge: null });
    expect(applyOffers([], offers())).toMatchObject({ subtotalPaise: 0, discountTotalPaise: 0, nudge: null });
  });

  it("does not nudge a cart with nothing eligible in it", () => {
    expect(applyOffers(cart({ bhel: 2 }), offers()).nudge).toBeNull();
  });

  it("rejects fractional paise", () => {
    expect(() => applyOffers([{ key: "x", menuItemId: "x", priceInPaise: 10.5, qty: 1 }], [])).toThrow();
  });
});

describe("offer copy", () => {
  it("formats basis points without floats", () => {
    expect(formatPercentBps(1000)).toBe("10%");
    expect(formatPercentBps(1250)).toBe("12.5%");
    expect(formatPercentBps(705)).toBe("7.05%");
  });

  it("summarises an offer for the storefront chip", () => {
    const [weekly] = offers([WEEKLY]);
    expect(offerSummary(weekly!)).toBe("Weekly Plan: 4+ quiche items incl. 1 paneer → 10% off");
  });

  it("words a nudge that needs both more items and the required kind", () => {
    const r = applyOffers(cart({ q_pcc: 1 }), offers([WEEKLY]));
    expect(offerNudgeText(r.nudge!)).toBe(
      "Add 3 more quiche items, including 1 paneer, to unlock 10% off (Weekly Plan)",
    );
  });

  it("labels the discount row", () => {
    expect(discountLabel("Weekly Plan")).toBe("Discount (Weekly Plan)");
    expect(discountLabel(null)).toBe("Discount");
  });
});
