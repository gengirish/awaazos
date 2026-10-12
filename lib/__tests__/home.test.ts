import { describe, expect, it } from "vitest";

import { HOME_PATH, resolveHomePath } from "@/lib/home";

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
