import { describe, expect, it } from "vitest";

import { composeDeliveryAddress, isValidPincode, normalisePincode, storedAddressParts } from "@/lib/delivery-address";

describe("composeDeliveryAddress", () => {
  it("joins the parts into one line", () => {
    expect(
      composeDeliveryAddress({ line: "Flat 302, Lake View", locality: "Kondapur", landmark: "Ganesh temple", pincode: "500 084" }),
    ).toBe("Flat 302, Lake View, Near Ganesh temple, Kondapur 500084");
  });

  it("doesn't say Near twice and skips empty parts", () => {
    expect(composeDeliveryAddress({ line: "12 MG Road", locality: "Indiranagar", landmark: "near Metro", pincode: "" })).toBe(
      "12 MG Road, near Metro, Indiranagar",
    );
    expect(composeDeliveryAddress({ line: "12 MG Road" })).toBe("12 MG Road");
  });
});

describe("pincode", () => {
  it("accepts 6 digits not starting with 0", () => {
    expect(isValidPincode("500084")).toBe(true);
    expect(isValidPincode("500 084")).toBe(true);
    expect(isValidPincode("050084")).toBe(false);
    expect(isValidPincode("50008")).toBe(false);
    expect(normalisePincode(" 560 064 ")).toBe("560064");
  });
});

describe("storedAddressParts", () => {
  it("stores empty parts as null", () => {
    expect(storedAddressParts({ locality: " Kondapur ", landmark: "", pincode: "" })).toEqual({
      locality: "Kondapur",
      landmark: null,
      pincode: null,
    });
  });
});
