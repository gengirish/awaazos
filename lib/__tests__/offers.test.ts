import { describe, expect, it } from "vitest";

import {
  applyOffers,
  discountLabel,
  formatPercentBps,
  giftLineName,
  isSaleOffer,
  OFFER_NAME_MAX,
  offerGiftText,
  offerIsLive,
  offerNudgeText,
  offerRuleSummary,
  offerSummary,
  overlappingOffers,
  resolveOffers,
  salePriceFor,
  withGiftsThatFit,
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
    freeItemId: null,
    freeItemQty: 1,
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

describe("sales — offers that need no quantity", () => {
  const sale = (over: Partial<OfferRule> & Pick<OfferRule, "id" | "name">) =>
    rule({ eligibility: "ALL", eligibleTag: null, requiredTag: null, requiredTagQty: 0, minQty: 1, ...over });
  const BHEL_20 = sale({ id: "bhel20", name: "Bhel sale", eligibility: "ITEMS", eligibleItemIds: ["bhel"], percentBps: 2000 });
  const QUICHE_10 = sale({ id: "quiche10", name: "Quiche sale", eligibility: "TAG", eligibleTag: "quiche", percentBps: 1000 });

  it("tells sales from plans", () => {
    const [s, p] = offers([QUICHE_10, WEEKLY]);
    expect(isSaleOffer(s!)).toBe(true);
    expect(isSaleOffer(p!)).toBe(false);
    // minQty 1 with "at least 1 paneer" is a condition, so a plan.
    expect(isSaleOffer(offers([sale({ id: "x", name: "X", requiredTag: "paneer", requiredTagQty: 1 })])[0]!)).toBe(false);
  });

  it("gives the card price, and the cart charges exactly that per unit", () => {
    const live = offers([QUICHE_10]);
    // ₹55 at 10% → ₹49.50.
    expect(salePriceFor(live, "q_pcc", 5500)).toEqual({ salePricePaise: 4950, offerId: "quiche10", offerName: "Quiche sale", percentBps: 1000 });
    expect(salePriceFor(live, "bhel", 4000)).toBeNull();
    const r = applyOffers(cart({ q_pcc: 3 }), live);
    expect(r.totalPaise).toBe(3 * 4950);
  });

  it("rounds each unit down, so price × qty is the bill", () => {
    const odd = sale({ id: "odd", name: "Odd", percentBps: 1250 });
    const live = resolveOffers([odd], [], { channel: "POS", now: NOW });
    // 12.5% of 3333 = 416.6 → 416 per unit; the card shows 2917.
    expect(salePriceFor(live, "a", 3333)!.salePricePaise).toBe(2917);
    const r = applyOffers([{ key: "a", menuItemId: "a", priceInPaise: 3333, qty: 3 }], live);
    expect(r.totalPaise).toBe(3 * 2917);
  });

  it("applies different sales to different items in one order", () => {
    const r = applyOffers(cart({ q_pcc: 1, bhel: 1 }), offers([QUICHE_10, BHEL_20]));
    expect(r.lines.map((l) => l.discountPaise)).toEqual([550, 800]);
    expect(r.discounts.map((d) => d.offerId)).toEqual(["bhel20", "quiche10"]);
    expect(r.applied).toMatchObject({ offerId: "bhel20", name: "Bhel sale + Quiche sale", discountPaise: 1350, percentBps: 2000 });
  });

  it("takes the deepest sale on an item", () => {
    const all5 = sale({ id: "all5", name: "Everything 5%", percentBps: 500 });
    expect(salePriceFor(offers([all5, BHEL_20]), "bhel", 4000)!.offerId).toBe("bhel20");
    const r = applyOffers(cart({ bhel: 1, q_pcc: 1 }), offers([all5, BHEL_20]));
    expect(r.lines.map((l) => l.discountPaise)).toEqual([800, 275]);
  });

  it("keeps the sale prices unless a plan saves more, and never stacks a plan on them", () => {
    const four = cart({ q_pcc: 1, q_rbz: 1, q_pcz: 1, q_psp: 1 });
    // Sale 5% on quiches (₹14) vs Weekly Plan 10% (₹28): the plan wins alone.
    const q5 = sale({ id: "q5", name: "Quiche 5%", eligibility: "TAG", eligibleTag: "quiche", percentBps: 500 });
    const plan = applyOffers(four, offers([q5, WEEKLY]));
    expect(plan.applied).toMatchObject({ offerId: "weekly", discountPaise: 2800 });
    expect(plan.discounts).toHaveLength(1);
    // A 10% sale ties the 10% plan: the buyer keeps the prices they were shown.
    const tie = applyOffers(four, offers([QUICHE_10, WEEKLY]));
    expect(tie.applied!.offerId).toBe("quiche10");
    expect(tie.discountTotalPaise).toBe(2800);
  });

  it("only nudges toward a plan that beats the sale already in the cart", () => {
    expect(applyOffers(cart({ q_pcz: 1 }), offers([QUICHE_10, WEEKLY])).nudge).toBeNull();
    expect(applyOffers(cart({ q_pcz: 1 }), offers([QUICHE_10, FAMILY])).nudge!.offerId).toBe("family");
  });

  it("shortens a combined name to fit the bill's column", () => {
    const long = (id: string) => sale({ id, name: `${id} ${"x".repeat(40)}`, eligibility: "ITEMS", eligibleItemIds: [id] });
    const r = applyOffers(cart({ q_pcc: 1, bhel: 1, q_rbz: 1 }), offers([long("q_pcc"), long("bhel"), long("q_rbz")]));
    expect(r.applied!.name.length).toBeLessThanOrEqual(OFFER_NAME_MAX);
    expect(r.applied!.name).toMatch(/ \+ 2 more$/);
  });

  it("reads as a sale in the offer chips", () => {
    expect(offerSummary(offers([QUICHE_10])[0]!)).toBe("Quiche sale: 10% off quiche items");
    expect(offerSummary(offers([sale({ id: "all", name: "Diwali sale" })])[0]!)).toBe("Diwali sale: 10% off everything");
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

  it("summarises a stored offer for the Settings list", () => {
    const all = rule({ id: "a", name: "A", eligibility: "ALL", eligibleTag: null, requiredTag: null, requiredTagQty: 0 });
    expect(offerRuleSummary(all)).toBe("10% off 4 or more items");
    expect(offerRuleSummary(WEEKLY)).toBe('10% off 4 or more items tagged "quiche", including 1 tagged "paneer"');
    expect(offerRuleSummary({ ...all, eligibility: "ITEMS", eligibleItemIds: ["x", "y", "z"] })).toBe(
      "10% off 4 or more of 3 chosen items",
    );
    expect(offerRuleSummary({ ...all, minQty: 1, percentBps: 3500 })).toBe("Sale · 35% off all items");
    expect(offerRuleSummary({ ...all, minQty: 1, eligibility: "ITEMS", eligibleItemIds: ["x"] })).toBe(
      "Sale · 10% off 1 chosen item",
    );
    const gift = { ...all, minQty: 2, discountType: "FREE_ITEM" as const, percentBps: 0 };
    expect(offerRuleSummary(gift, "Bhel with Image")).toBe("Free Bhel with Image with 2 or more items");
    expect(offerRuleSummary({ ...gift, freeItemQty: 2 }, "Bhel")).toBe("2 free Bhel with 2 or more items");
    expect(offerRuleSummary(gift, null)).toBe("A free item no longer listed with 2 or more items");
  });

  it("labels the discount row", () => {
    expect(discountLabel("Weekly Plan")).toBe("Discount (Weekly Plan)");
    expect(discountLabel(null)).toBe("Discount");
  });
});

describe("free-item plans", () => {
  // A wellness store: "4+ items → free Evil Eye Bracelet", beside "5+ items → 20% off".
  const STORE = [
    { id: "mala", name: "Karungali Mala", priceInPaise: 79900, tags: [] },
    { id: "rose", name: "Rose Quartz Bracelet", priceInPaise: 65000, tags: [] },
    { id: "jasper", name: "Red Jasper", priceInPaise: 45000, tags: [] },
    { id: "evil", name: "Evil Eye Bracelet", priceInPaise: 25000, tags: [] },
  ];
  const GIFT = rule({
    id: "gift",
    name: "Festive gift",
    eligibility: "ALL",
    eligibleTag: null,
    requiredTag: null,
    requiredTagQty: 0,
    discountType: "FREE_ITEM",
    percentBps: 0,
    freeItemId: "evil",
  });
  const TWENTY = rule({
    id: "twenty",
    name: "Festive offer",
    eligibility: "ALL",
    eligibleTag: null,
    requiredTag: null,
    requiredTagQty: 0,
    minQty: 5,
    percentBps: 2000,
    createdAt: new Date("2026-10-02T00:00:00Z"),
  });
  const resolve = (rules: OfferRule[], channel: "MENU" | "DROP" | "POS" = "MENU") =>
    resolveOffers(rules, STORE, { channel, now: NOW });
  const lines = (qtyById: Record<string, number>): OfferLine[] =>
    Object.entries(qtyById).map(([id, qty]) => ({
      key: id,
      menuItemId: id,
      priceInPaise: STORE.find((m) => m.id === id)!.priceInPaise,
      qty,
    }));

  it("adds the gift at 4 items and takes nothing off the bill", () => {
    const r = applyOffers(lines({ jasper: 4 }), resolve([GIFT]));
    expect(r.gift).toEqual({
      offerId: "gift",
      offerName: "Festive gift",
      menuItemId: "evil",
      name: "Evil Eye Bracelet",
      qty: 1,
      valuePaise: 25000,
    });
    expect(r.subtotalPaise).toBe(180000);
    expect(r.discountTotalPaise).toBe(0);
    expect(r.totalPaise).toBe(180000);
    expect(r.lines.every((l) => l.discountPaise === 0)).toBe(true);
    expect(r.applied).toMatchObject({ offerId: "gift", name: "Festive gift", discountPaise: 0 });
  });

  it("does not count the gift toward the minimum", () => {
    const r = applyOffers(lines({ jasper: 3 }), resolve([GIFT]));
    expect(r.gift).toBeNull();
    expect(offerNudgeText(r.nudge!)).toBe("Add 1 more item to get a free Evil Eye Bracelet (Festive gift)");
  });

  it("counts a paid copy of the gift item like any other item", () => {
    const r = applyOffers(lines({ evil: 2, jasper: 2 }), resolve([GIFT]));
    expect(r.gift?.qty).toBe(1);
    expect(r.totalPaise).toBe(140000);
  });

  it("never stacks with a percentage plan: the bigger saving wins", () => {
    // 5 × ₹450 = ₹2,250; 20% = ₹450 beats the ₹250 bracelet.
    const r = applyOffers(lines({ jasper: 5 }), resolve([GIFT, TWENTY]));
    expect(r.gift).toBeNull();
    expect(r.discountTotalPaise).toBe(45000);
    expect(r.applied?.name).toBe("Festive offer");
  });

  it("keeps the gift when it is worth more than the percentage", () => {
    const cheap = rule({ ...TWENTY, id: "five", name: "5% off", percentBps: 500 });
    // 5% of ₹2,250 = ₹112.50 < ₹250.
    const r = applyOffers(lines({ jasper: 5 }), resolve([GIFT, cheap]));
    expect(r.gift?.offerId).toBe("gift");
    expect(r.discountTotalPaise).toBe(0);
  });

  it("nudges toward the gift only when it beats what the cart already saves", () => {
    const sale = rule({ ...TWENTY, id: "sale", name: "Big sale", minQty: 1, percentBps: 5000 });
    // 3 × ₹450 at 50% saves ₹675, more than the bracelet.
    const r = applyOffers(lines({ jasper: 3 }), resolve([GIFT, sale]));
    expect(r.nudge).toBeNull();
  });

  it("gives several when the seller asks", () => {
    const two = rule({ ...GIFT, freeItemQty: 2 });
    const r = applyOffers(lines({ jasper: 4 }), resolve([two]));
    expect(r.gift).toMatchObject({ qty: 2, valuePaise: 50000 });
    expect(offerSummary(resolve([two])[0]!)).toBe("Festive gift: 4+ items → 2 free Evil Eye Bracelet");
  });

  it("is never a sale, even at a minimum of 1", () => {
    const one = resolve([rule({ ...GIFT, minQty: 1 })])[0]!;
    expect(isSaleOffer(one)).toBe(false);
    expect(salePriceFor([one], "jasper", 45000)).toBeNull();
  });

  it("is left out on the counter and when its item is gone", () => {
    expect(resolve([GIFT], "POS")).toEqual([]);
    expect(resolve([rule({ ...GIFT, freeItemId: "deleted" })])).toEqual([]);
    expect(offerIsLive(GIFT, NOW)).toBe(true);
  });

  it("drops an offer whose gift does not fit", () => {
    const resolved = resolve([GIFT, TWENTY]);
    expect(withGiftsThatFit(resolved, () => false).map((o) => o.id)).toEqual(["twenty"]);
    expect(withGiftsThatFit(resolved, () => true).map((o) => o.id)).toEqual(["gift", "twenty"]);
  });

  it("reads as a free item in the chip and the cart", () => {
    expect(offerSummary(resolve([GIFT])[0]!)).toBe("Festive gift: 4+ items → free Evil Eye Bracelet");
    const r = applyOffers(lines({ jasper: 4 }), resolve([GIFT]));
    expect(offerGiftText(r.gift!)).toBe("Festive gift: free Evil Eye Bracelet added.");
    expect(giftLineName("Evil Eye Bracelet")).toBe("Evil Eye Bracelet (free gift)");
  });
});

describe("overlappingOffers", () => {
  const base = {
    isActive: true,
    discountType: "PERCENT" as const,
    eligibility: "ALL" as const,
    eligibleItemIds: [],
    eligibleTag: null,
    minQty: 5,
    requiredTagQty: 0,
    onMenuOrders: true,
    onDrops: false,
    onPos: false,
    dropIds: [],
    startsOn: null,
    endsOn: null,
  };
  const twenty = { ...base, id: "twenty", name: "Festive offer" };
  const gift = { ...base, id: "gift", name: "Festive gift", discountType: "FREE_ITEM" as const, minQty: 4 };
  const names = (pairs: ReturnType<typeof overlappingOffers>) => pairs.map(([a, b]) => `${a.name} + ${b.name}`);

  it("warns when a gift and a percentage plan can meet in one order", () => {
    expect(names(overlappingOffers([twenty, gift]))).toEqual(["Festive offer + Festive gift"]);
  });

  it("stays quiet when they cannot", () => {
    expect(overlappingOffers([twenty, { ...gift, isActive: false }])).toEqual([]);
    expect(overlappingOffers([twenty, { ...gift, onMenuOrders: false, onDrops: true }])).toEqual([]);
    expect(overlappingOffers([{ ...twenty, endsOn: "2026-11-01" }, { ...gift, startsOn: "2026-11-02" }])).toEqual([]);
    expect(
      overlappingOffers([
        { ...twenty, eligibility: "TAG", eligibleTag: "malas" },
        { ...gift, eligibility: "TAG", eligibleTag: "bracelets" },
      ]),
    ).toEqual([]);
    // Two sales: each item takes its deepest, nothing to warn about.
    expect(overlappingOffers([{ ...twenty, minQty: 1 }, { ...twenty, id: "b", name: "B", minQty: 1 }])).toEqual([]);
    // A gift is never on the counter, so an overlap only there doesn't count.
    expect(
      overlappingOffers([
        { ...twenty, onMenuOrders: false, onPos: true },
        { ...gift, onMenuOrders: false, onPos: true },
      ]),
    ).toEqual([]);
  });
});
