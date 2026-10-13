import { describe, expect, it } from "vitest";

import { instagramProfileUrl, normaliseInstagramHandle } from "@/lib/instagram";

describe("normaliseInstagramHandle", () => {
  it("stores a bare lower-case handle", () => {
    expect(normaliseInstagramHandle("ammas.kitchen")).toBe("ammas.kitchen");
    expect(normaliseInstagramHandle("  @Ammas_Kitchen ")).toBe("ammas_kitchen");
  });

  it("accepts a pasted profile link", () => {
    expect(normaliseInstagramHandle("https://www.instagram.com/ammas.kitchen/?hl=en")).toBe("ammas.kitchen");
    expect(normaliseInstagramHandle("instagram.com/Ammas.Kitchen")).toBe("ammas.kitchen");
  });

  it("is empty for blank input, so the field can be cleared", () => {
    expect(normaliseInstagramHandle("")).toBe("");
    expect(normaliseInstagramHandle("   ")).toBe("");
    expect(normaliseInstagramHandle(null)).toBe("");
  });

  it("rejects anything that is not a username", () => {
    expect(normaliseInstagramHandle("amma's kitchen")).toBeNull();
    expect(normaliseInstagramHandle("a".repeat(31))).toBeNull();
    expect(normaliseInstagramHandle("https://evil.example/ammas")).toBeNull();
    expect(normaliseInstagramHandle("instagram.com/p/abc/def")).toBeNull();
    expect(normaliseInstagramHandle("javascript:alert(1)")).toBeNull();
  });
});

describe("instagramProfileUrl", () => {
  it("links a stored handle", () => {
    expect(instagramProfileUrl("ammas.kitchen")).toBe("https://www.instagram.com/ammas.kitchen/");
  });

  it("is null for a missing or malformed stored value", () => {
    expect(instagramProfileUrl(null)).toBeNull();
    expect(instagramProfileUrl("")).toBeNull();
    expect(instagramProfileUrl("ammas/../x")).toBeNull();
  });
});
