import { describe, expect, it } from "vitest";

import {
  draftToBulkItem,
  initialPaymentChoice,
  initialStateName,
  isBlankDraft,
  ONBOARDING_STEPS,
  paymentChoiceProblem,
  progressAfter,
  resumeStep,
  stepDescription,
  validateItemDraft,
} from "./onboarding-steps";

describe("resumeStep", () => {
  it("opens on step 1 until the store details are saved, whatever was recorded", () => {
    expect(resumeStep({ city: null, upiId: null, itemCount: 0 })).toBe(1);
    expect(resumeStep({ city: "  ", upiId: "a@okaxis", itemCount: 3, savedStep: 3 })).toBe(1);
  });

  it("opens after the highest step done, so a skipped step stays skipped", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 1 })).toBe(2);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 2 })).toBe(3);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 3 })).toBe(4);
  });

  it("never opens past the last step", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 4 })).toBe(4);
  });

  it("ignores a recorded step outside the wizard", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 9 })).toBe(2);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 1.5 })).toBe(2);
  });

  it("without a recorded step (setup started before it existed), opens on the first step with nothing saved", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0 })).toBe(2);
    expect(resumeStep({ city: "Pune", upiId: "a@okaxis", itemCount: 0 })).toBe(3);
    expect(resumeStep({ city: "Pune", upiId: "a@okaxis", itemCount: 2 })).toBe(4);
  });
});

describe("progressAfter", () => {
  it("records a step the server doesn't have yet", () => {
    expect(progressAfter(null, 1)).toBe(1);
    expect(progressAfter(1, 2)).toBe(2);
    expect(progressAfter(1, 3)).toBe(3);
  });

  it("only moves forward, so Back then Next records nothing", () => {
    expect(progressAfter(3, 2)).toBeNull();
    expect(progressAfter(2, 2)).toBeNull();
  });

  it("ignores a step outside the wizard", () => {
    expect(progressAfter(null, 0)).toBeNull();
    expect(progressAfter(null, 9)).toBeNull();
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

describe("stepDescription", () => {
  it("keeps the kitchen wording and swaps in the product wording only where a step has one", () => {
    expect(stepDescription(ONBOARDING_STEPS[0]!, "food")).toBe("Where you cook and sell from. You can change this later.");
    expect(stepDescription(ONBOARDING_STEPS[0]!, "goods")).toBe("Where you sell from. You can change this later.");
    expect(stepDescription(ONBOARDING_STEPS[2]!, "goods")).toContain("in Products");
    expect(stepDescription(ONBOARDING_STEPS[1]!, "goods")).toBe(ONBOARDING_STEPS[1]!.description);
  });
});

describe("payment step", () => {
  it("opens a first visit on UPI alone, whatever the database default says", () => {
    expect(initialPaymentChoice({ upiId: null, acceptPayOnDelivery: true, answered: false })).toEqual({
      upi: true,
      payOnDelivery: false,
    });
  });

  it("shows what was saved once the step has been answered", () => {
    expect(initialPaymentChoice({ upiId: null, acceptPayOnDelivery: true, answered: true })).toEqual({
      upi: false,
      payOnDelivery: true,
    });
    expect(initialPaymentChoice({ upiId: "a@okaxis", acceptPayOnDelivery: false, answered: true })).toEqual({
      upi: true,
      payOnDelivery: false,
    });
  });

  it("needs at least one way to pay", () => {
    const none = { upi: false, upiId: "", payOnDelivery: false, online: false };
    expect(paymentChoiceProblem(none)).toBe("choose_one");
    expect(paymentChoiceProblem({ ...none, payOnDelivery: true })).toBeNull();
    expect(paymentChoiceProblem({ ...none, online: true })).toBeNull();
    expect(paymentChoiceProblem({ ...none, upi: true, upiId: "a@okaxis" })).toBeNull();
  });

  it("asks for the ID when UPI is ticked, even with another way to pay", () => {
    expect(paymentChoiceProblem({ upi: true, upiId: "  ", payOnDelivery: true, online: true })).toBe("upi_missing");
  });
});
