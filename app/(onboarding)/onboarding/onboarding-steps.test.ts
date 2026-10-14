import { describe, expect, it } from "vitest";

import {
  draftToBulkItem,
  initialStateName,
  isBlankDraft,
  ONBOARDING_STEPS,
  resumeStep,
  validateItemDraft,
} from "./onboarding-steps";

describe("resumeStep", () => {
  it("opens on step 1 until the store details are saved, whatever the tab remembers", () => {
    expect(resumeStep({ city: null, upiId: null, itemCount: 0 })).toBe(1);
    expect(resumeStep({ city: "  ", upiId: "a@okaxis", itemCount: 3, storedStep: 4 })).toBe(1);
  });

  it("trusts the tab's step once step 1 is saved, so a skipped step stays skipped", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, storedStep: 3 })).toBe(3);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, storedStep: 4 })).toBe(4);
  });

  it("ignores a step outside the wizard", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, storedStep: 9 })).toBe(2);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, storedStep: 1.5 })).toBe(2);
  });

  it("without a remembered step, opens on the first step with nothing saved", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0 })).toBe(2);
    expect(resumeStep({ city: "Pune", upiId: "a@okaxis", itemCount: 0 })).toBe(3);
    expect(resumeStep({ city: "Pune", upiId: "a@okaxis", itemCount: 2 })).toBe(4);
  });
});

describe("initialStateName", () => {
  it("is empty for a new store, even though the column has a default", () => {
    expect(initialStateName(null, "Telangana")).toBe("");
  });

  it("keeps the saved state once step 1 has been saved", () => {
    expect(initialStateName("Hyderabad", "Telangana")).toBe("Telangana");
    expect(initialStateName("Pune", "Maharashtra")).toBe("Maharashtra");
  });
});

describe("menu item drafts", () => {
  it("a row with nothing typed is blank", () => {
    expect(isBlankDraft({ name: " ", priceRupees: "" })).toBe(true);
    expect(isBlankDraft({ name: "", priceRupees: "20" })).toBe(false);
  });

  it("needs a name and a price above zero with at most 2 decimals", () => {
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "150" })).toEqual({});
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "12.50" })).toEqual({});
    expect(validateItemDraft({ name: "", priceRupees: "150" }).name).toBeDefined();
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "" }).price).toBeDefined();
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "0" }).price).toBeDefined();
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "abc" }).price).toBeDefined();
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "12.555" }).price).toBe("Use at most 2 decimal places.");
    expect(validateItemDraft({ name: "Ragi laddu", priceRupees: "100001" }).price).toBe("That price looks too high.");
  });

  it("posts trimmed names and integer paise", () => {
    expect(draftToBulkItem({ name: "  Ragi laddu ", priceRupees: " 150 " })).toEqual({
      name: "Ragi laddu",
      priceInPaise: 15000,
    });
    expect(draftToBulkItem({ name: "Chai", priceRupees: "12.5" })).toEqual({ name: "Chai", priceInPaise: 1250 });
  });
});

describe("step copy", () => {
  it("has four steps and never says stall", () => {
    expect(ONBOARDING_STEPS.map((s) => s.title)).toEqual(["Your store", "Getting paid", "What you sell", "Order alerts"]);
    for (const s of ONBOARDING_STEPS) expect(`${s.title} ${s.description}`.toLowerCase()).not.toContain("stall");
  });
});
