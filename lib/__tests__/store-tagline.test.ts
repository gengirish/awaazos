import { describe, expect, it } from "vitest";

import { isValidStoreTagline, normaliseStoreTagline, STORE_TAGLINE_MAX } from "@/lib/store-tagline";

describe("store tagline", () => {
  it("trims, collapses whitespace and newlines, and treats blank as none", () => {
    expect(normaliseStoreTagline("  Energised crystals \n and malas  ")).toBe("Energised crystals and malas");
    expect(normaliseStoreTagline("   ")).toBeNull();
    expect(normaliseStoreTagline("")).toBeNull();
    expect(normaliseStoreTagline(null)).toBeNull();
    expect(normaliseStoreTagline(undefined)).toBeNull();
  });

  it("accepts none, a short line and the maximum; rejects one character and longer", () => {
    expect(isValidStoreTagline(null)).toBe(true);
    expect(isValidStoreTagline("Home bakes")).toBe(true);
    expect(isValidStoreTagline("x".repeat(STORE_TAGLINE_MAX))).toBe(true);
    expect(isValidStoreTagline("x")).toBe(false);
    expect(isValidStoreTagline("x".repeat(STORE_TAGLINE_MAX + 1))).toBe(false);
  });
});
