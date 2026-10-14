import { describe, expect, it } from "vitest";

import {
  buildDemoStorePayload,
  buildSampleOrders,
  suggestExternalRef,
  type DemoStoreFormValues,
} from "@/lib/demo-store-form";
import { demoStoreCreateSchema, findForbiddenPaymentField } from "@/lib/demo-store-schema";

// 2026-10-14 22:30 IST (17:00 UTC): late evening, to catch UTC/IST day slips.
const NOW = new Date("2026-10-14T17:00:00Z");

const ITEMS = [
  { name: "Two-Tier Celebration Cake (2.5 kg)", price_paise: 550_000 },
  { name: "Engagement Cake (2 kg)", price_paise: 450_000 },
  { name: "Theme Birthday Cake (1 kg)", price_paise: 220_000 },
  { name: "Corporate Logo Cake", price_paise: 160_000 },
  { name: "Chocolate Truffle Cake", price_paise: 120_000 },
  { name: "Red Velvet Cake", price_paise: 140_000 },
  { name: "Cupcakes", price_paise: 60_000 },
];

function form(overrides: Partial<DemoStoreFormValues> = {}): DemoStoreFormValues {
  return {
    externalRef: "queens-saga-sahakar-nagar",
    name: "Queen's Saga",
    category: "home_bakery",
    area: "Sahakar Nagar, Bengaluru",
    instagram: "@queenssaga",
    displayPhone: "+91 98454 31188",
    languages: ["en", "kn"],
    fulfilment: "both",
    deliveryFeeRupees: "",
    items: ITEMS.map((i) => ({ name: i.name, unit: "", priceRupees: String(i.price_paise / 100), category: "" })),
    withSampleOrders: true,
    ...overrides,
  };
}

function totalOf(order: { lines: { item: string; qty: number }[] }, items: { name: string; price_paise: number }[]) {
  return order.lines.reduce((s, l) => s + items.find((i) => i.name === l.item)!.price_paise * l.qty, 0);
}

describe("buildSampleOrders", () => {
  it("makes the eight-order story: 2 placed, 6 confirmed (1 fully paid, 1 overdue)", () => {
    const orders = buildSampleOrders(ITEMS, NOW);
    expect(orders).toHaveLength(8);
    expect(orders.filter((o) => o.status === "placed")).toHaveLength(2);
    expect(orders.filter((o) => o.status === "placed").every((o) => o.advance_paid_paise === 0)).toBe(true);

    const totals = orders.map((o) => totalOf(o, ITEMS));
    const fullyPaid = orders.filter((o, i) => o.advance_paid_paise === totals[i]);
    expect(fullyPaid).toHaveLength(1);
    const overdue = orders.filter((o) => o.event_date! < "2026-10-14");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].advance_paid_paise).toBeLessThan(totalOf(overdue[0], ITEMS));
    orders.forEach((o, i) => expect(o.advance_paid_paise).toBeLessThanOrEqual(totals[i]));
  });

  it("dates events from the IST day, not the UTC day", () => {
    const orders = buildSampleOrders(ITEMS, NOW);
    // Plan: +1 day is the fully paid order; IST today is the 14th → the 15th.
    expect(orders[6].event_date).toBe("2026-10-15T16:00:00+05:30");
    expect(orders[7].event_date).toBe("2026-10-11T18:00:00+05:30");
  });

  it("uses fictional names and the reserved 9199999000xx phones", () => {
    const phones = buildSampleOrders(ITEMS, NOW).map((o) => o.customer_phone);
    expect(new Set(phones).size).toBe(8);
    phones.forEach((p) => expect(p).toMatch(/^9199999000\d{2}$/));
  });

  it("wraps round a short menu and merges repeats of one dish", () => {
    const one = [{ name: "Brownie Box", price_paise: 50_000 }];
    const orders = buildSampleOrders(one, NOW);
    expect(orders).toHaveLength(8);
    orders.forEach((o) => {
      expect(o.lines).toHaveLength(1);
      expect(o.lines[0].item).toBe("Brownie Box");
    });
    expect(orders[6].lines[0].qty).toBe(2);
  });

  it("returns nothing for no dishes", () => {
    expect(buildSampleOrders([], NOW)).toEqual([]);
  });
});

describe("suggestExternalRef", () => {
  it("joins the name and the first part of the area", () => {
    expect(suggestExternalRef("Queen's Saga", "Sahakar Nagar, Bengaluru")).toBe("queen-s-saga-sahakar-nagar");
  });
  it("is empty until there is enough to make a valid ref", () => {
    expect(suggestExternalRef("", "")).toBe("");
    expect(suggestExternalRef("A", "")).toBe("");
  });
  it("stays within 80 characters and never ends on a dash", () => {
    const ref = suggestExternalRef("x".repeat(79) + " y", "");
    expect(ref.length).toBeLessThanOrEqual(80);
    expect(ref.endsWith("-")).toBe(false);
  });
});

describe("buildDemoStorePayload", () => {
  it("builds a payload the API schema accepts, with no payment fields", () => {
    const built = buildDemoStorePayload(form(), NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(findForbiddenPaymentField(built.payload)).toBeNull();
    const parsed = demoStoreCreateSchema.safeParse(built.payload);
    expect(parsed.success).toBe(true);
    expect(built.payload.items[0].price_paise).toBe(550_000);
    expect(built.payload.profile.display_phone).toBe("+919845431188");
    expect(built.payload.sample_orders).toHaveLength(8);
  });

  it("skips blank rows and can leave the sample orders out", () => {
    const f = form({ withSampleOrders: false });
    f.items.push({ name: "", unit: "", priceRupees: "", category: "" });
    const built = buildDemoStorePayload(f, NOW);
    expect(built.ok && built.payload.items.length).toBe(7);
    expect(built.ok && built.payload.sample_orders).toEqual([]);
  });

  it("refuses a dish without a name, a zero price and more than 2 decimals", () => {
    expect(buildDemoStorePayload(form({ items: [{ name: "", unit: "", priceRupees: "100", category: "" }] }), NOW).ok).toBe(false);
    expect(buildDemoStorePayload(form({ items: [{ name: "Cake", unit: "", priceRupees: "0", category: "" }] }), NOW).ok).toBe(false);
    expect(buildDemoStorePayload(form({ items: [{ name: "Cake", unit: "", priceRupees: "10.005", category: "" }] }), NOW).ok).toBe(false);
    expect(buildDemoStorePayload(form({ items: [] }), NOW).ok).toBe(false);
  });

  it("charges a delivery fee only when the store delivers", () => {
    const delivers = buildDemoStorePayload(form({ deliveryFeeRupees: "40" }), NOW);
    expect(delivers.ok && delivers.payload.profile.delivery_fee_paise).toBe(4_000);
    const pickup = buildDemoStorePayload(form({ fulfilment: "pickup", deliveryFeeRupees: "40" }), NOW);
    expect(pickup.ok && pickup.payload.profile.delivery_fee_paise).toBe(0);
  });
});
