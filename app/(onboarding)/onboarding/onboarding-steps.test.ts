import { describe, expect, it } from "vitest";

import { storeVocabulary } from "@/lib/store-vocabulary";

import {
  contactPatch,
  contactProblems,
  doneNextAction,
  draftToBulkItem,
  finishPatch,
  handoverProblems,
  indianMobileE164,
  initialFeeInput,
  initialHandoverMode,
  initialOrderMode,
  initialPaymentChoice,
  initialStateName,
  isBlankDraft,
  ONBOARDING_STEPS,
  paymentChoiceProblem,
  progressAfter,
  resumeStep,
  reviewRows,
  STEP_COUNT,
  stepDescription,
  takesMenuOrders,
  validateItemDraft,
  type ReviewInput,
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

  it("goes on through the later steps and never opens past the last one", () => {
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 4 })).toBe(5);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 5 })).toBe(6);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: 6 })).toBe(7);
    expect(resumeStep({ city: "Pune", upiId: null, itemCount: 0, savedStep: STEP_COUNT })).toBe(STEP_COUNT);
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
  it("has seven steps and never says stall", () => {
    expect(ONBOARDING_STEPS.map((s) => s.title)).toEqual([
      "Your store",
      "Getting paid",
      "What you sell",
      "How you take orders",
      "Pickup or delivery",
      "Contact and alerts",
      "Check and publish",
    ]);
    for (const s of ONBOARDING_STEPS) expect(`${s.title} ${s.description}`.toLowerCase()).not.toContain("stall");
  });

  it("gives every step a one-word name for the progress row", () => {
    for (const s of ONBOARDING_STEPS) expect(s.short).toMatch(/^\S{1,10}$/);
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

describe("orders step", () => {
  it("asks for a pick on a first visit: menu orders off is the default, not an answer", () => {
    expect(initialOrderMode({ acceptMenuOrders: false, answered: false })).toBeNull();
    expect(initialOrderMode({ acceptMenuOrders: true, answered: false })).toBeNull();
  });

  it("reads back what was saved; menu orders on reads as both", () => {
    expect(initialOrderMode({ acceptMenuOrders: false, answered: true })).toBe("drops");
    expect(initialOrderMode({ acceptMenuOrders: true, answered: true })).toBe("both");
  });

  it("turns menu orders on for the menu and for both, never for drops alone", () => {
    expect(takesMenuOrders("drops")).toBe(false);
    expect(takesMenuOrders("menu")).toBe(true);
    expect(takesMenuOrders("both")).toBe(true);
  });
});

describe("pickup or delivery step", () => {
  it("asks for a pick on a first visit, then shows the saved one", () => {
    expect(initialHandoverMode({ mode: "PICKUP", answered: false })).toBeNull();
    expect(initialHandoverMode({ mode: "BOTH", answered: true })).toBe("BOTH");
  });

  it("starts the fee empty until delivery was offered, so free delivery is never a default", () => {
    expect(initialFeeInput(0, "PICKUP", true)).toBe("");
    expect(initialFeeInput(0, "DELIVERY", false)).toBe("");
    expect(initialFeeInput(0, "DELIVERY", true)).toBe("0");
    expect(initialFeeInput(2550, "BOTH", true)).toBe("25.5");
  });

  it("needs a mode, and a fee (0 included) when delivering", () => {
    expect(handoverProblems({ mode: null, feePaise: 3000 }).mode).toBeDefined();
    expect(handoverProblems({ mode: "PICKUP", feePaise: null })).toEqual({});
    expect(handoverProblems({ mode: "DELIVERY", feePaise: null }).fee).toBeDefined();
    expect(handoverProblems({ mode: "BOTH", feePaise: undefined }).fee).toBeDefined();
    expect(handoverProblems({ mode: "DELIVERY", feePaise: 0 })).toEqual({});
  });
});

describe("contact step", () => {
  const blank = { whatsapp: "", acceptWhatsappOrders: false, showWhatsappOnStore: false, instagram: "", fssai: "" };
  const nothingSaved = { whatsapp: "", instagram: "", fssai: "" };

  it("takes Indian mobiles only, stored as E.164", () => {
    expect(indianMobileE164("98765 43210")).toBe("+919876543210");
    expect(indianMobileE164("+91 98765-43210")).toBe("+919876543210");
    expect(indianMobileE164("040 2345 6789")).toBeNull();
    expect(indianMobileE164("12345")).toBeNull();
  });

  it("asks nothing of a blank step", () => {
    expect(contactProblems(blank)).toEqual({});
  });

  it("checks what is typed, and wants a number before either switch shows it", () => {
    expect(contactProblems({ ...blank, whatsapp: "12345" }).wa).toBeDefined();
    expect(contactProblems({ ...blank, acceptWhatsappOrders: true }).wa).toBeDefined();
    expect(contactProblems({ ...blank, showWhatsappOnStore: true }).wa).toBeDefined();
    expect(contactProblems({ ...blank, whatsapp: "9876543210", showWhatsappOnStore: true })).toEqual({});
    expect(contactProblems({ ...blank, instagram: "not a handle!" }).instagram).toBeDefined();
    expect(contactProblems({ ...blank, fssai: "123" }).fssai).toBeDefined();
    expect(contactProblems({ ...blank, fssai: "12345678901234" })).toEqual({});
  });

  it("sends the switches, and a field only when typed or clearing a saved value", () => {
    expect(contactPatch(blank, nothingSaved, "food")).toEqual({ acceptWhatsappOrders: false, showWhatsappOnStore: false });
    expect(
      contactPatch(
        { ...blank, whatsapp: "98765 43210", acceptWhatsappOrders: true, instagram: "@Ammas.Kitchen", fssai: "12345678901234" },
        nothingSaved,
        "food",
      ),
    ).toEqual({
      acceptWhatsappOrders: true,
      showWhatsappOnStore: false,
      whatsappNumber: "+919876543210",
      instagramHandle: "ammas.kitchen",
      fssaiNumber: "12345678901234",
    });
    expect(contactPatch(blank, { whatsapp: "+919876543210", instagram: "ammas", fssai: "12345678901234" }, "food")).toEqual({
      acceptWhatsappOrders: false,
      showWhatsappOnStore: false,
      whatsappNumber: null,
      instagramHandle: "",
      fssaiNumber: "",
    });
  });

  it("never sends an FSSAI number for a store that doesn't sell food", () => {
    expect(contactPatch({ ...blank, fssai: "12345678901234" }, nothingSaved, "goods")).not.toHaveProperty("fssaiNumber");
  });
});

describe("check and publish step", () => {
  const food = storeVocabulary("HOME_KITCHEN");
  const goods = storeVocabulary("CLOTHING");
  const answers: ReviewInput = {
    store: { typeLabel: "Home kitchen", city: "Pune", state: "Maharashtra" },
    payment: { upiId: "amma@okaxis", payOnDelivery: true, online: false },
    items: [
      { name: "Puran Poli", priceInPaise: 6000 },
      { name: "Modak", priceInPaise: 2500 },
      { name: "Thalipeeth", priceInPaise: 8000 },
      { name: "Chakli", priceInPaise: 15000 },
    ],
    orderMode: "both",
    handover: { mode: "BOTH", pickupNote: "Gate 2", feePaise: 3000, areas: [{ name: "Kothrud", feePaise: null }] },
    contact: {
      whatsapp: "+919876543210",
      acceptWhatsappOrders: true,
      showWhatsappOnStore: false,
      instagram: "amma.kitchen",
      fssai: "12345678901234",
    },
  };

  it("has one card per earlier step, each going back to its own step", () => {
    const rows = reviewRows(answers, food);
    expect(rows.map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.title)).toEqual(ONBOARDING_STEPS.slice(0, 6).map((s) => s.title));
  });

  it("says what was answered, in a kitchen's words", () => {
    expect(reviewRows(answers, food).map((r) => r.lines)).toEqual([
      ["Home kitchen", "Pune, Maharashtra"],
      ["UPI to amma@okaxis", "Pay on delivery"],
      ["4 dishes", "Puran Poli ₹60, Modak ₹25, Thalipeeth ₹80 and 1 more"],
      ["Pre-orders, and your menu any time"],
      ["Pickup or delivery, customers choose", "Pickup: Gate 2", "Delivery fee ₹30", "Delivers to Kothrud"],
      ["WhatsApp 98765 43210, shown to customers who order", "Instagram @amma.kitchen", "FSSAI 12345678901234"],
    ]);
  });

  it("uses a goods store's words and never shows it an FSSAI line", () => {
    const rows = reviewRows(
      { ...answers, items: [answers.items[0]!], orderMode: "menu", contact: { ...answers.contact, showWhatsappOnStore: true } },
      goods,
    );
    expect(rows[2]!.lines).toEqual(["1 product", "Puran Poli ₹60"]);
    expect(rows[3]!.lines).toEqual(["Order any time: your product list any time"]);
    expect(rows[5]!.lines).toEqual(["WhatsApp 98765 43210, shown on your store page", "Instagram @amma.kitchen"]);
  });

  it("reads free delivery, pickup without a note and online payment", () => {
    const rows = reviewRows(
      {
        ...answers,
        payment: { upiId: "", payOnDelivery: false, online: true },
        handover: { mode: "DELIVERY", pickupNote: "Gate 2", feePaise: 0, areas: [] },
      },
      food,
    );
    expect(rows[1]!.lines).toEqual(["Online with your Razorpay"]);
    expect(rows[4]!.lines).toEqual(["Delivery", "Free delivery"]);
  });

  it("marks a step with nothing in it, and an empty contact step as nothing added", () => {
    const rows = reviewRows(
      {
        store: { typeLabel: "", city: "", state: "" },
        payment: { upiId: "", payOnDelivery: false, online: false },
        items: [],
        orderMode: null,
        handover: { mode: null, pickupNote: "", feePaise: null, areas: [] },
        contact: { whatsapp: "", acceptWhatsappOrders: false, showWhatsappOnStore: false, instagram: "", fssai: "" },
      },
      food,
    );
    expect(rows.slice(0, 5).every((r) => r.lines[0] === "Not answered yet")).toBe(true);
    expect(rows[5]!.lines).toEqual(["Nothing added"]);
  });

  it("finishes and publishes in one request, or finishes alone", () => {
    expect(finishPatch(true, "")).toEqual({ onboardingDone: true, publishStorefront: true });
    expect(finishPatch(false, "")).toEqual({ onboardingDone: true });
  });

  it("sends a saved WhatsApp number again, so receipts turn on", () => {
    expect(finishPatch(false, "+919876543210")).toEqual({ onboardingDone: true, whatsappNumber: "+919876543210" });
  });

  it("leads the done screen with the first drop, the orders board or publishing", () => {
    expect(doneNextAction("drops", true)).toBe("first-drop");
    expect(doneNextAction("both", false)).toBe("first-drop");
    expect(doneNextAction("menu", true)).toBe("orders");
    expect(doneNextAction("menu", false)).toBe("publish");
  });
});
