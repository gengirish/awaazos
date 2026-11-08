import { describe, expect, it } from "vitest";

import { deliveryAreasSchema } from "@/lib/delivery-areas-schema";
import {
  deliveryAreaKey,
  deliveryAreaSummary,
  deliveryFeeFor,
  findDeliveryArea,
  MAX_DELIVERY_AREAS,
  parseDeliveryAreas,
  toDeliveryArea,
} from "@/lib/delivery-areas";
import { CHOOSE_AREA_MESSAGE, checkoutFieldForErrorCode, validateCheckoutField } from "@/lib/storefront-order";

const AREAS = [
  { name: "Kondapur", feePaise: 0 },
  { name: "Gachibowli", feePaise: 0 },
  { name: "Madhapur", feePaise: null },
];

describe("toDeliveryArea / parseDeliveryAreas", () => {
  it("keeps a name and a fee, null meaning the usual fee", () => {
    expect(toDeliveryArea({ name: "  Kondapur  ", feePaise: 0 })).toEqual({ name: "Kondapur", feePaise: 0 });
    expect(toDeliveryArea({ name: "Madhapur" })).toEqual({ name: "Madhapur", feePaise: null });
    expect(toDeliveryArea({ name: "HITEC  City", feePaise: 4000 })).toEqual({ name: "HITEC City", feePaise: 4000 });
  });

  it("refuses no name, punctuation only, fractional paise and fees past ₹1,000", () => {
    expect(toDeliveryArea({ name: "" })).toBeNull();
    expect(toDeliveryArea({ name: "--" })).toBeNull();
    expect(toDeliveryArea({ name: "A", feePaise: 10.5 })).toBeNull();
    expect(toDeliveryArea({ name: "A", feePaise: -1 })).toBeNull();
    expect(toDeliveryArea({ name: "A", feePaise: 100_001 })).toBeNull();
    expect(toDeliveryArea("Kondapur")).toBeNull();
  });

  it("drops bad entries and repeats, keeps the first spelling, caps the list", () => {
    expect(parseDeliveryAreas([{ name: "Kondapur" }, { name: "kondapur " }, { bad: 1 }, null])).toEqual([
      { name: "Kondapur", feePaise: null },
    ]);
    expect(parseDeliveryAreas("nope")).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Area ${i}` }));
    expect(parseDeliveryAreas(many)).toHaveLength(MAX_DELIVERY_AREAS);
  });
});

describe("matching a locality", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(deliveryAreaKey("Gachi-bowli ")).toBe("gachibowli");
    expect(findDeliveryArea(AREAS, " gachibowli")?.name).toBe("Gachibowli");
    expect(findDeliveryArea(AREAS, "Miyapur")).toBeNull();
    expect(findDeliveryArea(AREAS, "")).toBeNull();
  });

  it("no areas: anywhere, at the usual fee", () => {
    expect(deliveryFeeFor([], "Anywhere", 3000)).toEqual({ ok: true, feePaise: 3000, area: null });
  });

  it("an area's own fee replaces the usual one; null keeps it; elsewhere is refused", () => {
    expect(deliveryFeeFor(AREAS, "Kondapur", 3000)).toMatchObject({ ok: true, feePaise: 0 });
    expect(deliveryFeeFor(AREAS, "Madhapur", 3000)).toMatchObject({ ok: true, feePaise: 3000 });
    expect(deliveryFeeFor(AREAS, "Miyapur", 3000)).toEqual({ ok: false });
    expect(deliveryFeeFor(AREAS, null, 3000)).toEqual({ ok: false });
  });
});

describe("deliveryAreaSummary", () => {
  it("groups by fee, free first", () => {
    expect(deliveryAreaSummary(AREAS, 3000)).toBe("Free delivery in Kondapur, Gachibowli · ₹30 delivery in Madhapur");
    expect(deliveryAreaSummary(AREAS, 0)).toBe("Free delivery in Kondapur, Gachibowli, Madhapur");
  });

  it("shortens a long list and is null with no areas", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((name) => ({ name, feePaise: 2000 }));
    expect(deliveryAreaSummary(six, 0)).toBe("₹20 delivery in A, B, C and 3 more");
    expect(deliveryAreaSummary([], 0)).toBeNull();
  });
});

describe("deliveryAreasSchema (PATCH /api/vendor)", () => {
  it("accepts a list and refuses repeats and bad fees", () => {
    expect(deliveryAreasSchema.parse([{ name: "Kondapur", feePaise: 0 }])).toEqual([{ name: "Kondapur", feePaise: 0 }]);
    expect(deliveryAreasSchema.safeParse([{ name: "Kondapur" }, { name: "KONDAPUR" }]).success).toBe(false);
    expect(deliveryAreasSchema.safeParse([{ name: "Kondapur", feePaise: 200_000 }]).success).toBe(false);
    expect(deliveryAreasSchema.safeParse(Array.from({ length: 21 }, (_, i) => ({ name: `A${i}` }))).success).toBe(false);
  });
});

describe("checkout with areas", () => {
  const input = {
    name: "Asha",
    phone: "9876543210",
    address: "Flat 2",
    locality: "",
    pincode: "",
    fulfilment: "DELIVERY" as const,
    method: "UPI" as const,
    slotRequired: false,
    slot: null,
    areas: AREAS,
  };

  it("needs one of the store's areas for delivery, nothing for pickup", () => {
    expect(validateCheckoutField("locality", input)).toBe(CHOOSE_AREA_MESSAGE);
    expect(validateCheckoutField("locality", { ...input, locality: "Miyapur" })).toBe(CHOOSE_AREA_MESSAGE);
    expect(validateCheckoutField("locality", { ...input, locality: "Kondapur" })).toBeNull();
    expect(validateCheckoutField("locality", { ...input, fulfilment: "PICKUP" })).toBeNull();
    expect(validateCheckoutField("locality", { ...input, areas: [], locality: "Miyapur" })).toBeNull();
  });

  it("puts the server's refusal on the locality field", () => {
    expect(checkoutFieldForErrorCode("outside_delivery_area")).toBe("locality");
  });
});
