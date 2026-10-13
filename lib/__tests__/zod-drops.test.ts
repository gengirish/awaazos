import { describe, expect, it } from "vitest";

import {
  dropInputToData,
  dropStatusChangeSchema,
  dropUpsertSchema,
  indianPhoneE164,
  storefrontOrderSchema,
  utrSubmitSchema,
} from "@/lib/zod-drops";

const valid = {
  title: "Saturday Bakes",
  date: "2026-10-10",
  fulfilmentMode: "DELIVERY" as const,
  fulfilmentStart: "17:00",
  fulfilmentEnd: "20:00",
  deliveryFeePaise: 3000,
  closesAtDate: "2026-10-09",
  closesAtTime: "21:00",
  items: [
    { menuItemId: "m1", priceInPaise: 12000, maxQty: 20 },
    { menuItemId: "m2", priceInPaise: 4500 },
  ],
};

function issuesFor(input: unknown) {
  const r = dropUpsertSchema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues;
}

describe("dropUpsertSchema", () => {
  it("accepts a well-formed drop and fills defaults", () => {
    const r = dropUpsertSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[1]).toMatchObject({ maxQty: null, perOrderLimit: null, sortOrder: 0 });
    }
  });

  it("rejects a window that ends at or before it starts", () => {
    expect(issuesFor({ ...valid, fulfilmentEnd: "17:00" }).some((i) => i.path[0] === "fulfilmentEnd")).toBe(true);
    expect(issuesFor({ ...valid, fulfilmentEnd: "16:00" }).some((i) => i.path[0] === "fulfilmentEnd")).toBe(true);
  });

  it("rejects a cut-off after the window starts", () => {
    const issues = issuesFor({ ...valid, closesAtDate: "2026-10-10", closesAtTime: "17:01" });
    expect(issues.some((i) => i.path[0] === "closesAtTime")).toBe(true);
  });

  it("allows a cut-off exactly at window start", () => {
    expect(dropUpsertSchema.safeParse({ ...valid, closesAtDate: "2026-10-10", closesAtTime: "17:00" }).success).toBe(
      true,
    );
  });

  it("rejects a half-specified opensAt", () => {
    expect(issuesFor({ ...valid, opensAtDate: "2026-10-08" }).some((i) => i.path[0] === "opensAtTime")).toBe(true);
    expect(issuesFor({ ...valid, opensAtTime: "09:00" }).some((i) => i.path[0] === "opensAtTime")).toBe(true);
  });

  it("rejects opensAt at or after closesAt", () => {
    const issues = issuesFor({ ...valid, opensAtDate: "2026-10-09", opensAtTime: "21:00" });
    expect(issues.some((i) => i.path[0] === "opensAtTime")).toBe(true);
  });

  it("rejects the same menu item twice", () => {
    const issues = issuesFor({
      ...valid,
      items: [
        { menuItemId: "m1", priceInPaise: 100 },
        { menuItemId: "m1", priceInPaise: 200 },
      ],
    });
    expect(issues.some((i) => i.path.join(".") === "items.1.menuItemId")).toBe(true);
  });

  it("rejects non-integer or zero prices", () => {
    expect(issuesFor({ ...valid, items: [{ menuItemId: "m1", priceInPaise: 45.5 }] }).length).toBeGreaterThan(0);
    expect(issuesFor({ ...valid, items: [{ menuItemId: "m1", priceInPaise: 0 }] }).length).toBeGreaterThan(0);
  });

  it("rejects a per-order limit above the item's total quantity", () => {
    const issues = issuesFor({
      ...valid,
      items: [{ menuItemId: "m1", priceInPaise: 12000, maxQty: 5, perOrderLimit: 6 }],
    });
    const issue = issues.find((i) => i.path.join(".") === "items.0.perOrderLimit");
    expect(issue?.message).toMatch(/can't be more than how many you can make/);
  });

  it("accepts a per-order limit equal to the total, or with either side unlimited", () => {
    for (const item of [
      { maxQty: 6, perOrderLimit: 6 },
      { maxQty: null, perOrderLimit: 6 },
      { maxQty: 5, perOrderLimit: null },
    ]) {
      const r = dropUpsertSchema.safeParse({ ...valid, items: [{ menuItemId: "m1", priceInPaise: 12000, ...item }] });
      expect(r.success).toBe(true);
    }
  });

  it("returns issues (does not throw) for malformed or impossible times", () => {
    expect(() => dropUpsertSchema.safeParse({ ...valid, fulfilmentStart: "25:00" })).not.toThrow();
    expect(issuesFor({ ...valid, fulfilmentStart: "25:00" }).some((i) => i.path[0] === "fulfilmentStart")).toBe(true);
    expect(() => dropUpsertSchema.safeParse({ ...valid, date: "2026-02-30" })).not.toThrow();
    expect(issuesFor({ ...valid, date: "2026-02-30" }).some((i) => i.path[0] === "date")).toBe(true);
    expect(() =>
      dropUpsertSchema.safeParse({ ...valid, opensAtDate: "2026-13-01", opensAtTime: "09:00" }),
    ).not.toThrow();
  });
});

describe("dropInputToData", () => {
  it("converts IST wall-clock to UTC instants", () => {
    const d = dropInputToData(dropUpsertSchema.parse(valid));
    expect(d.date.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(d.fulfilmentStartsAt.toISOString()).toBe("2026-10-10T11:30:00.000Z");
    expect(d.fulfilmentEndsAt.toISOString()).toBe("2026-10-10T14:30:00.000Z");
    expect(d.closesAt.toISOString()).toBe("2026-10-09T15:30:00.000Z");
    expect(d.opensAt).toBeNull();
    expect(d.deliveryFeePaise).toBe(3000);
  });

  it("forces deliveryFeePaise to 0 for pickup-only drops", () => {
    const d = dropInputToData(dropUpsertSchema.parse({ ...valid, fulfilmentMode: "PICKUP", deliveryFeePaise: 5000 }));
    expect(d.deliveryFeePaise).toBe(0);
  });

  it("keeps the fee for BOTH", () => {
    const d = dropInputToData(dropUpsertSchema.parse({ ...valid, fulfilmentMode: "BOTH" }));
    expect(d.deliveryFeePaise).toBe(3000);
  });

  it("blank notes become null", () => {
    const d = dropInputToData(dropUpsertSchema.parse({ ...valid, note: "   ", pickupNote: "" }));
    expect(d.note).toBeNull();
    expect(d.pickupNote).toBeNull();
  });
});

describe("dropStatusChangeSchema", () => {
  it("accepts a bare status change", () => {
    expect(dropStatusChangeSchema.parse({ status: "CLOSED" })).toEqual({ status: "CLOSED" });
  });

  it("publishStorefront is only ever true, and only with OPEN", () => {
    expect(dropStatusChangeSchema.parse({ status: "OPEN", publishStorefront: true })).toEqual({
      status: "OPEN",
      publishStorefront: true,
    });
    expect(dropStatusChangeSchema.safeParse({ status: "OPEN", publishStorefront: false }).success).toBe(false);
    expect(dropStatusChangeSchema.safeParse({ status: "OPEN", publishStorefront: "yes" }).success).toBe(false);
    for (const status of ["DRAFT", "CLOSED", "FROZEN", "FULFILLED"]) {
      expect(dropStatusChangeSchema.safeParse({ status, publishStorefront: true }).success).toBe(false);
    }
  });
});

describe("indianPhoneE164", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["  +919876543210 ", "+919876543210"],
  ])("normalises %s → %s", (input, out) => {
    expect(indianPhoneE164.parse(input)).toBe(out);
  });

  it.each(["+14155552671", "+447911123456", "12345", "abcdefghij", ""])("rejects %s", (input) => {
    expect(indianPhoneE164.safeParse(input).success).toBe(false);
  });
});

describe("storefrontOrderSchema", () => {
  const order = {
    dropId: "d1",
    items: [{ dropItemId: "di1", qty: 2 }],
    customerName: "Meera",
    customerPhone: "9876543210",
    fulfilmentType: "DELIVERY",
    deliveryAddress: "12 MG Road",
    paymentMethod: "UPI",
  };

  it("accepts a valid order and normalises the phone", () => {
    const r = storefrontOrderSchema.parse(order);
    expect(r.customerPhone).toBe("+919876543210");
  });

  it("has no price fields — client-sent prices are stripped", () => {
    const keys = Object.keys(storefrontOrderSchema.shape);
    expect(keys.some((k) => /price|paise|total|fee/i.test(k))).toBe(false);
    const itemKeys = Object.keys(storefrontOrderSchema.shape.items.element.shape);
    expect(itemKeys.sort()).toEqual(["dropItemId", "qty"]);

    const r = storefrontOrderSchema.parse({
      ...order,
      totalPaise: 1,
      items: [{ dropItemId: "di1", qty: 1, priceInPaise: 1 }],
    });
    expect(r).not.toHaveProperty("totalPaise");
    expect(r.items[0]).not.toHaveProperty("priceInPaise");
  });

  it("rejects zero / fractional / huge quantities and empty carts", () => {
    expect(storefrontOrderSchema.safeParse({ ...order, items: [{ dropItemId: "di1", qty: 0 }] }).success).toBe(false);
    expect(storefrontOrderSchema.safeParse({ ...order, items: [{ dropItemId: "di1", qty: 1.5 }] }).success).toBe(
      false,
    );
    expect(storefrontOrderSchema.safeParse({ ...order, items: [{ dropItemId: "di1", qty: 100 }] }).success).toBe(
      false,
    );
    expect(storefrontOrderSchema.safeParse({ ...order, items: [] }).success).toBe(false);
  });

  it("rejects non-Indian phones", () => {
    expect(storefrontOrderSchema.safeParse({ ...order, customerPhone: "+14155552671" }).success).toBe(false);
  });
});

describe("utrSubmitSchema", () => {
  it("accepts a 12-digit UTR and rejects junk", () => {
    expect(utrSubmitSchema.safeParse({ upiRef: "412345678901" }).success).toBe(true);
    expect(utrSubmitSchema.safeParse({ upiRef: "12-34" }).success).toBe(false);
  });

  it("the UTR is optional: a bare I've paid tap sends none", () => {
    expect(utrSubmitSchema.parse({})).toEqual({ upiRef: undefined });
    expect(utrSubmitSchema.parse({ upiRef: "" }).upiRef).toBeUndefined();
    expect(utrSubmitSchema.parse({ upiRef: "   " }).upiRef).toBeUndefined();
    expect(utrSubmitSchema.parse({ upiRef: " 412345678901 " }).upiRef).toBe("412345678901");
  });
});
