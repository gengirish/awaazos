import { describe, expect, it } from "vitest";

import {
  CART_TTL_MS,
  CHECKOUT_FIELD_MESSAGES,
  MAX_LINE_QTY,
  cartStorageKey,
  checkoutErrorsFromIssues,
  checkoutFieldForErrorCode,
  firstInvalidField,
  looksLikeIndianMobile,
  parseSavedBuyer,
  parseStoredCart,
  restoreCartLines,
  sameCartLines,
  serializeCart,
  validateCheckout,
  validateCheckoutField,
  type CheckoutInput,
} from "@/lib/storefront-order";

const NOW = Date.UTC(2026, 9, 5, 6, 30);

describe("cartStorageKey", () => {
  it("scopes menu and per-drop carts by store", () => {
    expect(cartStorageKey("ammas-kitchen", { kind: "menu" })).toBe("awz-cart:ammas-kitchen:menu");
    expect(cartStorageKey("ammas-kitchen", { kind: "drop", dropId: "d1" })).toBe(
      "awz-cart:ammas-kitchen:drop:d1",
    );
  });
});

describe("serializeCart / parseStoredCart", () => {
  it("round-trips ids + quantities with savedAt, nothing else", () => {
    const raw = serializeCart({ a: 2, b: 1 }, NOW);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ v: 1, savedAt: NOW, lines: { a: 2, b: 1 } });
    expect(parseStoredCart(raw, NOW + 1000)).toEqual({ savedAt: NOW, lines: { a: 2, b: 1 } });
  });

  it("returns null for an empty cart (nothing to save)", () => {
    expect(serializeCart({}, NOW)).toBeNull();
    expect(serializeCart({ a: 0, b: -1 }, NOW)).toBeNull();
  });

  it("drops junk quantities", () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, lines: { a: 2, b: "3", c: 1.5, d: 0, "": 4 } });
    expect(parseStoredCart(raw, NOW)?.lines).toEqual({ a: 2 });
  });

  it("expires carts older than 24 h", () => {
    const raw = serializeCart({ a: 1 }, NOW);
    expect(parseStoredCart(raw, NOW + CART_TTL_MS)).not.toBeNull();
    expect(parseStoredCart(raw, NOW + CART_TTL_MS + 1)).toBeNull();
  });

  it("rejects malformed, missing, or other-version entries", () => {
    expect(parseStoredCart(null, NOW)).toBeNull();
    expect(parseStoredCart("", NOW)).toBeNull();
    expect(parseStoredCart("{not json", NOW)).toBeNull();
    expect(parseStoredCart("[]", NOW)).toBeNull();
    expect(parseStoredCart(JSON.stringify({ v: 2, savedAt: NOW, lines: { a: 1 } }), NOW)).toBeNull();
    expect(parseStoredCart(JSON.stringify({ v: 1, lines: { a: 1 } }), NOW)).toBeNull();
    expect(parseStoredCart(JSON.stringify({ v: 1, savedAt: NOW, lines: [1] }), NOW)).toBeNull();
  });

  it("treats a far-future savedAt as invalid rather than immortal", () => {
    const raw = serializeCart({ a: 1 }, NOW + 2 * CART_TTL_MS);
    expect(parseStoredCart(raw, NOW)).toBeNull();
  });
});

describe("restoreCartLines", () => {
  it("drops items that are gone and clamps to the current max", () => {
    const max: Record<string, number | null> = { a: 5, b: 2, gone: null, soldOut: 0 };
    expect(restoreCartLines({ a: 3, b: 4, gone: 1, soldOut: 2 }, (id) => max[id] ?? null)).toEqual({
      a: 3,
      b: 2,
    });
  });

  it("never exceeds the schema ceiling", () => {
    expect(restoreCartLines({ a: 500 }, () => 1000)).toEqual({ a: MAX_LINE_QTY });
  });
});

describe("sameCartLines", () => {
  it("ignores key order", () => {
    expect(sameCartLines({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameCartLines({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameCartLines({ a: 1 }, { a: 1, b: 1 })).toBe(false);
  });
});

describe("parseSavedBuyer", () => {
  it("reads current entries", () => {
    const raw = JSON.stringify({ name: "Priya", phone: "98480 12345", address: "", fulfilment: "PICKUP", savedAt: 5 });
    expect(parseSavedBuyer(raw)).toEqual({
      name: "Priya",
      phone: "98480 12345",
      address: "",
      fulfilment: "PICKUP",
      savedAt: 5,
    });
  });

  it("tolerates entries saved before fulfilment / savedAt existed", () => {
    expect(parseSavedBuyer(JSON.stringify({ name: "Ravi", phone: 9, address: "Flat 2" }))).toEqual({
      name: "Ravi",
      phone: "",
      address: "Flat 2",
      fulfilment: null,
      savedAt: 0,
    });
  });

  it("returns null for absent or broken storage", () => {
    expect(parseSavedBuyer(null)).toBeNull();
    expect(parseSavedBuyer("nope")).toBeNull();
    expect(parseSavedBuyer("null")).toBeNull();
  });
});

describe("checkout validation", () => {
  const valid: CheckoutInput = {
    name: "Priya",
    phone: "98480 12345",
    address: "",
    fulfilment: "PICKUP",
    method: "CASH",
  };

  it("accepts a complete pickup order", () => {
    expect(validateCheckout(valid)).toEqual({});
  });

  it("reports every invalid field at once, in visual order", () => {
    const errors = validateCheckout({ name: "  ", phone: "123", address: " ", fulfilment: "DELIVERY", method: null });
    expect(errors).toEqual({
      name: "Please enter your name.",
      phone: "Enter a valid 10-digit +91 mobile number.",
      address: "Please enter a delivery address.",
      payment: CHECKOUT_FIELD_MESSAGES.payment,
    });
    expect(firstInvalidField(errors)).toBe("name");
    expect(firstInvalidField({ payment: "x", phone: "y" })).toBe("phone");
    expect(firstInvalidField({})).toBeNull();
  });

  it("only requires an address for delivery", () => {
    expect(validateCheckoutField("address", { ...valid, fulfilment: "PICKUP" })).toBeNull();
    expect(validateCheckoutField("address", { ...valid, fulfilment: "DELIVERY" })).toBe(
      CHECKOUT_FIELD_MESSAGES.address,
    );
    expect(validateCheckoutField("address", { ...valid, fulfilment: "DELIVERY", address: "Flat 2" })).toBeNull();
  });

  it("recognises Indian mobiles in the usual shapes", () => {
    expect(looksLikeIndianMobile("98480 12345")).toBe(true);
    expect(looksLikeIndianMobile("+91 98480-12345")).toBe(true);
    expect(looksLikeIndianMobile("919848012345")).toBe(true);
    expect(looksLikeIndianMobile("58480 12345")).toBe(false);
    expect(looksLikeIndianMobile("98480")).toBe(false);
  });
});

describe("server rejection → field mapping", () => {
  it("maps field-specific 409 codes", () => {
    expect(checkoutFieldForErrorCode("address_required")).toBe("address");
    expect(checkoutFieldForErrorCode("pay_on_delivery_disabled")).toBe("payment");
    expect(checkoutFieldForErrorCode("sold_out")).toBeNull();
    expect(checkoutFieldForErrorCode("monthly_txn_cap_reached")).toBeNull();
  });

  it("maps 400 zod issues to fields with the sheet's wording", () => {
    expect(
      checkoutErrorsFromIssues([
        { path: ["customerPhone"], message: "Enter a valid +91 mobile number" },
        { path: ["customerName"], message: "String must contain at least 1 character(s)" },
      ]),
    ).toEqual({ phone: CHECKOUT_FIELD_MESSAGES.phone, name: CHECKOUT_FIELD_MESSAGES.name });
  });

  it("returns null when no issue belongs to a field", () => {
    expect(checkoutErrorsFromIssues([{ path: ["items", 0, "qty"], message: "too big" }])).toBeNull();
    expect(checkoutErrorsFromIssues(undefined)).toBeNull();
    expect(checkoutErrorsFromIssues([null, {}])).toBeNull();
  });
});
