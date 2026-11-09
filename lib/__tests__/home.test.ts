import { describe, expect, it } from "vitest";

import { HOME_PATH, resolveHomePath, safeCallbackPath } from "@/lib/home";

describe("resolveHomePath", () => {
  it("sends a published storefront to the orders board", () => {
    expect(resolveHomePath({ onboardingDone: true, publishStorefront: true })).toBe("/orders");
  });

  it("keeps a counter-only vendor on the POS", () => {
    expect(resolveHomePath({ onboardingDone: true, publishStorefront: false })).toBe("/pos");
  });

  it("treats a missing settings row as unpublished", () => {
    expect(resolveHomePath({ onboardingDone: true, publishStorefront: null })).toBe("/pos");
    expect(resolveHomePath({ onboardingDone: true, publishStorefront: undefined })).toBe("/pos");
  });

  it("finishes setup first, published or not", () => {
    expect(resolveHomePath({ onboardingDone: false, publishStorefront: false })).toBe("/onboarding");
    expect(resolveHomePath({ onboardingDone: false, publishStorefront: true })).toBe("/onboarding");
  });

  it("never resolves to itself", () => {
    for (const onboardingDone of [true, false]) {
      for (const publishStorefront of [true, false, null, undefined]) {
        expect(resolveHomePath({ onboardingDone, publishStorefront })).not.toBe(HOME_PATH);
      }
    }
  });
});

describe("safeCallbackPath", () => {
  it("keeps a path on this site, with its query and hash", () => {
    expect(safeCallbackPath("/onboarding")).toBe("/onboarding");
    expect(safeCallbackPath("/settings/billing?plan=starter&interval=yearly")).toBe(
      "/settings/billing?plan=starter&interval=yearly",
    );
    expect(safeCallbackPath("/orders#top")).toBe("/orders#top");
  });

  it("falls back to the landing when there is none", () => {
    expect(safeCallbackPath(null)).toBe(HOME_PATH);
    expect(safeCallbackPath(undefined)).toBe(HOME_PATH);
    expect(safeCallbackPath("")).toBe(HOME_PATH);
  });

  it("refuses anything that could leave the site", () => {
    for (const raw of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "\\evil.example",
      "/%2F%2Fevil.example",
      "/%5cevil.example",
      "javascript:alert(1)",
      "/\tevil",
      " /orders",
      "/" + "a".repeat(600),
    ]) {
      expect(safeCallbackPath(raw), raw).toBe(HOME_PATH);
    }
  });
});
