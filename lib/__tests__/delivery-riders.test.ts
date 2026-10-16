import { describe, expect, it } from "vitest";

import {
  deliveryRidersSchema,
  MAX_DELIVERY_RIDERS,
  parseDeliveryRiders,
} from "@/lib/delivery-riders";

describe("deliveryRidersSchema", () => {
  it("trims names and stores phones as E.164", () => {
    const r = deliveryRidersSchema.parse([{ name: "  Ramesh ", phone: "98765 43210" }]);
    expect(r).toEqual([{ name: "Ramesh", phone: "+919876543210" }]);
  });

  it("refuses landlines, short numbers and blank names", () => {
    expect(deliveryRidersSchema.safeParse([{ name: "A", phone: "080 2345 6789" }]).success).toBe(false);
    expect(deliveryRidersSchema.safeParse([{ name: "A", phone: "98765" }]).success).toBe(false);
    expect(deliveryRidersSchema.safeParse([{ name: " ", phone: "9876543210" }]).success).toBe(false);
  });

  it("refuses the same number twice and more than the cap", () => {
    const same = [
      { name: "A", phone: "9876543210" },
      { name: "B", phone: "+91 98765 43210" },
    ];
    expect(deliveryRidersSchema.safeParse(same).success).toBe(false);
    const many = Array.from({ length: MAX_DELIVERY_RIDERS + 1 }, (_, i) => ({
      name: `R${i}`,
      phone: `98765432${String(i).padStart(2, "0")}`,
    }));
    expect(deliveryRidersSchema.safeParse(many).success).toBe(false);
    expect(deliveryRidersSchema.safeParse(many.slice(0, MAX_DELIVERY_RIDERS)).success).toBe(true);
  });

  it("accepts an empty list (removes every rider)", () => {
    expect(deliveryRidersSchema.parse([])).toEqual([]);
  });
});

describe("parseDeliveryRiders", () => {
  it("reads stored JSON and drops anything malformed or repeated", () => {
    expect(
      parseDeliveryRiders([
        { name: "Ramesh", phone: "+919876543210" },
        { name: "", phone: "+919876543211" },
        { name: "Dup", phone: "+919876543210" },
        "junk",
        { name: "Suresh", phone: "+919812345678" },
      ]),
    ).toEqual([
      { name: "Ramesh", phone: "+919876543210" },
      { name: "Suresh", phone: "+919812345678" },
    ]);
  });

  it("is empty for null, objects and the column default", () => {
    expect(parseDeliveryRiders(null)).toEqual([]);
    expect(parseDeliveryRiders({})).toEqual([]);
    expect(parseDeliveryRiders([])).toEqual([]);
  });
});
