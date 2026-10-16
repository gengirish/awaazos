import { describe, expect, it } from "vitest";

import { STALL_TYPES } from "@/lib/constants";
import { resolveStallTypeOther, stallTypeLabel } from "@/lib/stall-type";
import { signUpSchema } from "@/lib/zod-auth";

const SIGN_UP = {
  email: "seller@example.com",
  password: "Str0ng-pass",
  name: "Riya",
  stallName: "Riya's Pickles",
};

describe("store type: Other", () => {
  it("lists Other last", () => {
    expect(STALL_TYPES.at(-1)?.value).toBe("OTHER");
  });

  it("needs a 2–40 character description for OTHER and tidies its spaces", () => {
    expect(resolveStallTypeOther("OTHER", "  Pickles   &  podis ")).toEqual({ ok: true, value: "Pickles & podis" });
    expect(resolveStallTypeOther("OTHER", "").ok).toBe(false);
    expect(resolveStallTypeOther("OTHER", " x ").ok).toBe(false);
    expect(resolveStallTypeOther("OTHER", "x".repeat(41)).ok).toBe(false);
    expect(resolveStallTypeOther("OTHER", undefined).ok).toBe(false);
  });

  it("drops any description for a listed type", () => {
    expect(resolveStallTypeOther("HOME_BAKERY", "Pickles")).toEqual({ ok: true, value: null });
  });

  it("labels the store with the seller's words for OTHER, the list label otherwise", () => {
    expect(stallTypeLabel("OTHER", "Pickles & podis")).toBe("Pickles & podis");
    expect(stallTypeLabel("OTHER", null)).toBe("Store");
    expect(stallTypeLabel("HOME_BAKERY", "ignored")).toBe("Home bakery");
  });

  it("sign-up refuses OTHER without a description, on the description field", () => {
    const missing = signUpSchema.safeParse({ ...SIGN_UP, stallType: "OTHER" });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.flatten().fieldErrors.stallTypeOther).toBeDefined();
    expect(signUpSchema.safeParse({ ...SIGN_UP, stallType: "OTHER", stallTypeOther: "Pickles" }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...SIGN_UP, stallType: "CAFE" }).success).toBe(true);
  });
});
