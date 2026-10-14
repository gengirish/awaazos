import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpOrderSignal: vi.fn() }));

import { samplePaymentFields } from "@/lib/demo-store";
import {
  demoHandoverSchema,
  demoStoreCreateSchema,
  demoVoiceLang,
  displayStoreName,
  findForbiddenPaymentField,
} from "@/lib/demo-store-schema";
import { INTERNAL_KEY_HEADER, isInternalCaller } from "@/lib/internal-auth";

function body(overrides: Record<string, unknown> = {}) {
  return {
    external_ref: "prankies-bakery-kondapur",
    profile: {
      name: "Prankie's Bakery",
      category: "home_bakery",
      area: "Kondapur, Hyderabad",
      instagram: "@prankiesbakery",
      display_phone: "+917396637770",
      languages: ["en", "hi", "te"],
    },
    items: [
      { name: "Chocolate Truffle Cake", unit: "kg", price_paise: 120000 },
      { name: "Bento Cake", unit: "piece", price_paise: 55000 },
    ],
    sample_orders: [
      {
        customer_name: "Ananya",
        customer_phone: "919999900001",
        lines: [{ item: "Chocolate Truffle Cake", qty: 2 }],
        event_date: "2026-10-18T18:00:00+05:30",
        advance_paid_paise: 100000,
        status: "confirmed",
      },
    ],
    ...overrides,
  };
}

function issuePaths(input: unknown): string[] {
  const r = demoStoreCreateSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}

describe("demoStoreCreateSchema", () => {
  it("accepts the documented example", () => {
    const r = demoStoreCreateSchema.safeParse(body());
    expect(r.success).toBe(true);
  });

  it("defaults: no sample orders, English, general category, placed, no advance", () => {
    const r = demoStoreCreateSchema.parse({
      external_ref: "abc",
      profile: { name: "X" },
      items: [{ name: "Tea", price_paise: 1500 }],
    });
    expect(r.sample_orders).toEqual([]);
    expect(r.profile.languages).toEqual(["en"]);
    expect(r.profile.category).toBe("general");
  });

  it.each(["9876543210", "+919876543210", "919999800001", "91999990000", "9199999000011", "+1 9199999000"])(
    "rejects sample phone %s",
    (phone) => {
      const b = body();
      b.sample_orders[0]!.customer_phone = phone;
      expect(issuePaths(b)).toContain("sample_orders.0.customer_phone");
    },
  );

  it("accepts +9199999xxxxx as well as 9199999xxxxx", () => {
    const b = body();
    b.sample_orders[0]!.customer_phone = "+919999900042";
    expect(issuePaths(b)).toEqual([]);
  });

  it.each([
    ["negative", -100],
    ["zero", 0],
    ["float", 120000.5],
    ["string", "1200"],
    ["above ₹1,00,000", 10_000_001],
  ])("rejects a %s item price", (_label, price) => {
    const b = body();
    (b.items[0] as Record<string, unknown>).price_paise = price;
    expect(issuePaths(b)).toContain("items.0.price_paise");
  });

  it("rejects a negative or float advance, and one above the order total", () => {
    for (const advance of [-1, 10.5, 240001]) {
      const b = body();
      b.sample_orders[0]!.advance_paid_paise = advance;
      expect(issuePaths(b)).toContain("sample_orders.0.advance_paid_paise");
    }
    const exact = body();
    exact.sample_orders[0]!.advance_paid_paise = 240000;
    expect(issuePaths(exact)).toEqual([]);
  });

  it("rejects an order line naming an item not in the request (matched case-insensitively)", () => {
    const b = body();
    b.sample_orders[0]!.lines = [
      { item: "chocolate truffle cake", qty: 1 },
      { item: "Red Velvet", qty: 1 },
    ];
    expect(issuePaths(b)).toEqual(["sample_orders.0.lines.1.item"]);
  });

  it("rejects a float or zero quantity", () => {
    for (const qty of [0, 1.5]) {
      const b = body();
      b.sample_orders[0]!.lines[0]!.qty = qty;
      expect(issuePaths(b)).toContain("sample_orders.0.lines.0.qty");
    }
  });

  it("rejects duplicate item names", () => {
    const b = body({ items: [{ name: "Tea", price_paise: 100 }, { name: " tea ", price_paise: 200 }] });
    expect(issuePaths(b)).toContain("items.1.name");
  });

  it("rejects unknown keys anywhere", () => {
    expect(issuePaths(body({ extra: 1 }))).toContain("");
    const b = body();
    (b.profile as Record<string, unknown>).owner_email = "a@b.co";
    expect(issuePaths(b).length).toBeGreaterThan(0);
  });

  it("rejects a bad external_ref", () => {
    expect(issuePaths(body({ external_ref: "Has Spaces" }))).toContain("external_ref");
    expect(issuePaths(body({ external_ref: "ab" }))).toContain("external_ref");
  });
});

describe("findForbiddenPaymentField", () => {
  it("passes the documented example (the Instagram @handle is not a UPI id)", () => {
    expect(findForbiddenPaymentField(body())).toBeNull();
  });

  it.each([
    [{ upi_id: "x" }, "upi_id"],
    [{ profile: { vpa: "x" } }, "profile.vpa"],
    [{ profile: { bank_account: "1234" } }, "profile.bank_account"],
    [{ ifsc: "HDFC0001234" }, "ifsc"],
    [{ razorpay_key_id: "rzp_live_x" }, "razorpay_key_id"],
    [{ payment: { card_number: "4111" } }, "payment.card_number"],
    [{ items: [{ name: "x", account_no: "1" }] }, "items.0.account_no"],
    [{ webhook_secret: "x" }, "webhook_secret"],
  ])("refuses key %j", (input, path) => {
    expect(findForbiddenPaymentField(input)).toBe(path);
  });

  it("refuses a UPI id hidden in a free-text value", () => {
    const b = body();
    b.profile.area = "Pay to prankie@okaxis";
    expect(findForbiddenPaymentField(b)).toBe("profile.area");
  });
});

describe("demoHandoverSchema", () => {
  it("lower-cases the email and rejects junk or extra keys", () => {
    expect(demoHandoverSchema.parse({ owner_email: " Owner@Example.COM " })).toEqual({
      owner_email: "owner@example.com",
    });
    expect(demoHandoverSchema.safeParse({ owner_email: "nope" }).success).toBe(false);
    expect(demoHandoverSchema.safeParse({ owner_email: "a@b.co", send: true }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("demoVoiceLang picks the first language the app offers", () => {
    expect(demoVoiceLang(["te", "hi", "en"])).toBe("hi-IN");
    expect(demoVoiceLang(["te", "kn"])).toBe("en-IN");
  });

  it("displayStoreName suffixes demo stores only", () => {
    expect(displayStoreName({ name: "Prankie's Bakery", isDemo: true })).toBe("Prankie's Bakery (DEMO)");
    expect(displayStoreName({ name: "Prankie's Bakery", isDemo: false })).toBe("Prankie's Bakery");
  });
});

describe("samplePaymentFields", () => {
  const at = new Date("2026-10-14T06:00:00.000Z");

  it("keeps a part advance on a pending UPI order", () => {
    expect(samplePaymentFields({ status: "confirmed", advance_paid_paise: 100000 }, 240000, at)).toMatchObject({
      paymentMethod: "UPI",
      paymentStatus: "PENDING",
      advancePaidPaise: 100000,
      fulfilmentStatus: "CONFIRMED",
      paidAt: null,
    });
  });

  it("an advance of the full total is simply paid", () => {
    expect(samplePaymentFields({ status: "placed", advance_paid_paise: 5000 }, 5000, at)).toMatchObject({
      paymentStatus: "PAID",
      advancePaidPaise: 0,
      paidAt: at,
    });
  });

  it("no advance is pay on delivery; delivered is paid; cancelled-after-paying is refunded", () => {
    expect(samplePaymentFields({ status: "placed", advance_paid_paise: 0 }, 5000, at)).toMatchObject({
      paymentMethod: "CASH",
      paymentStatus: "PENDING",
    });
    expect(samplePaymentFields({ status: "delivered", advance_paid_paise: 0 }, 5000, at)).toMatchObject({
      paymentStatus: "PAID",
      fulfilmentStatus: "DELIVERED",
    });
    expect(samplePaymentFields({ status: "cancelled", advance_paid_paise: 5000 }, 5000, at)).toMatchObject({
      paymentStatus: "REFUNDED",
      cancelledAt: at,
    });
  });
});

describe("isInternalCaller", () => {
  const KEY = "k".repeat(40);
  const req = (key?: string) =>
    new Request("http://x/api/internal/demo-stores", { headers: key ? { [INTERNAL_KEY_HEADER]: key } : {} });

  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  it("accepts only the exact key", () => {
    process.env.INTERNAL_API_KEY = KEY;
    expect(isInternalCaller(req(KEY))).toBe(true);
    expect(isInternalCaller(req())).toBe(false);
    expect(isInternalCaller(req(`${KEY}x`))).toBe(false);
    expect(isInternalCaller(req("k".repeat(39)))).toBe(false);
  });

  it("is off when the env key is missing or shorter than 32 characters", () => {
    expect(isInternalCaller(req(""))).toBe(false);
    process.env.INTERNAL_API_KEY = "short";
    expect(isInternalCaller(req("short"))).toBe(false);
  });
});
