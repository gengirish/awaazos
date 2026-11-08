import { paiseToRupees, rupeesToPaise } from "@/lib/currency";
import { FSSAI_NUMBER_MESSAGE, FSSAI_NUMBER_PATTERN } from "@/lib/fssai";
import { INSTAGRAM_HANDLE_MESSAGE, normaliseInstagramHandle } from "@/lib/instagram";
import { normaliseIndianMobile } from "@/lib/phone";
import type { StoreKind } from "@/lib/store-vocabulary";

/**
 * Pure rules of the first-run setup (page.tsx), kept out of the page so they
 * are unit-tested. Client-safe: no Prisma, no React.
 *
 * Each step is saved when the seller taps Next, through the endpoints the rest
 * of the app uses (PATCH /api/vendor, POST /api/menu/bulk). Every step needs an
 * answer: a way to get paid (`paymentChoiceProblem`), at least one item, how
 * orders come in (`OrderMode`), pickup or delivery (`handoverProblems`); the
 * contact step is optional and checks what is typed (`contactProblems`). After
 * each Next, `Vendor.onboardingStep` records the highest step done, so a reload
 * or another phone reopens the right one (`resumeStep`), even when the answer
 * looks like the default (pay on delivery only, no UPI ID).
 *
 * Every vendor page sends a store here until `onboardingDone`
 * (app/(vendor)/_shell-context.ts). Plan and decisions: docs/ONBOARDING_PLAN.md.
 */

/**
 * `goodsDescription` replaces `description` for a store that doesn't sell food
 * (lib/store-vocabulary.ts); see `stepDescription`.
 */
export const ONBOARDING_STEPS: readonly {
  title: string;
  /** A shorter name for the progress row, where six titles share a phone's width. */
  short: string;
  description: string;
  goodsDescription?: string;
}[] = [
  {
    title: "Your store",
    short: "Store",
    description: "Where you cook and sell from. You can change this later.",
    goodsDescription: "Where you sell from. You can change this later.",
  },
  {
    title: "Getting paid",
    short: "Payment",
    description: "Choose at least one way customers can pay. The money comes straight to you: AwaazOS never holds it.",
  },
  {
    title: "What you sell",
    short: "Menu",
    description: "Add at least one item with its price. Add the rest later in Menu.",
    goodsDescription: "Add at least one product with its price. Add the rest later in Products.",
  },
  {
    title: "How you take orders",
    short: "Orders",
    description: "Choose how customers order from you. You can change this later.",
  },
  {
    title: "Pickup or delivery",
    short: "Handover",
    description: "How customers get their order. Your first drop starts with these too.",
  },
  {
    title: "Contact and alerts",
    short: "Contact",
    description: "How customers reach you, and how you hear about a new order. All optional.",
  },
];

/** The line under a step's title, in the words of this kind of store. */
export function stepDescription(step: { description: string; goodsDescription?: string }, kind: StoreKind): string {
  return kind === "goods" && step.goodsDescription ? step.goodsDescription : step.description;
}

export const STEP_COUNT = ONBOARDING_STEPS.length;

export type OnboardingResumeInput = {
  /** `Vendor.city`; null until step 1 has been saved. */
  city: string | null;
  upiId: string | null;
  /** Menu items the store already has. */
  itemCount: number;
  /** `Vendor.onboardingStep`: the highest step done, if any. */
  savedStep?: number | null;
};

function isStepNumber(n: number | null | undefined): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= STEP_COUNT;
}

/**
 * The step to open on. An unsaved step 1 always wins. Past it, the step after
 * the highest one done (it tells "pay on delivery only" from "not there yet").
 * A store that started setup before `onboardingStep` existed has none: the
 * first step with nothing saved.
 */
export function resumeStep({ city, upiId, itemCount, savedStep }: OnboardingResumeInput): number {
  if (!city?.trim()) return 1;
  if (isStepNumber(savedStep)) return Math.min(savedStep + 1, STEP_COUNT);
  if (!upiId?.trim()) return 2;
  if (itemCount <= 0) return 3;
  // From step 4 on, answers look like defaults: carry on from there.
  return 4;
}

/**
 * What to record after finishing `step`, or null when the saved value already
 * covers it. Only moves forward: going Back and Next again records nothing.
 */
export function progressAfter(savedStep: number | null | undefined, step: number): number | null {
  if (!isStepNumber(step)) return null;
  return isStepNumber(savedStep) && savedStep >= step ? null : step;
}

/** Step 2's ticks. `online`: the store's own Razorpay can already take a payment. */
export type PaymentChoice = { upi: boolean; upiId: string; payOnDelivery: boolean; online: boolean };

/**
 * The ticks step 2 opens with. A step answered before (or a Connect Razorpay
 * round trip, which saves the ticks first) shows what is saved. A first visit
 * starts on UPI alone: `acceptPayOnDelivery` defaults to true in the database,
 * so a saved true there says nothing about what the seller wants.
 */
export function initialPaymentChoice(input: {
  upiId: string | null;
  acceptPayOnDelivery: boolean;
  answered: boolean;
}): { upi: boolean; payOnDelivery: boolean } {
  if (input.answered) return { upi: Boolean(input.upiId?.trim()), payOnDelivery: input.acceptPayOnDelivery };
  return { upi: true, payOnDelivery: false };
}

/**
 * Why step 2 can't be saved yet, or null. A ticked UPI needs its ID; with
 * nothing ticked and no Razorpay, customers would have no way to pay.
 * (The ID's format is checked separately, with `isValidUpiId`.)
 */
export function paymentChoiceProblem(c: PaymentChoice): "upi_missing" | "choose_one" | null {
  if (c.upi && !c.upiId.trim()) return "upi_missing";
  if (!c.upi && !c.payOnDelivery && !c.online) return "choose_one";
  return null;
}

// ── Step 4: how the store takes orders ──

/**
 * Drops (batches with a cut-off), the everyday menu at any time, or both. Only
 * the menu half is a setting (`acceptMenuOrders`): a drop is made when the
 * seller wants one, so choosing Drops creates nothing.
 */
export type OrderMode = "drops" | "menu" | "both";

export const ORDER_MODES: readonly OrderMode[] = ["drops", "menu", "both"];

export function takesMenuOrders(mode: OrderMode): boolean {
  return mode !== "drops";
}

/**
 * The pick step 4 opens with: none until the step is answered (the setting
 * defaults to off, which is not an answer). After that, what is saved; "menu"
 * and "both" save the same setting, so a saved "on" reads as both.
 */
export function initialOrderMode(input: { acceptMenuOrders: boolean; answered: boolean }): OrderMode | null {
  if (!input.answered) return null;
  return input.acceptMenuOrders ? "both" : "drops";
}

// ── Step 5: pickup or delivery ──

export type HandoverMode = "PICKUP" | "DELIVERY" | "BOTH";

/**
 * The pick step 5 opens with: none until answered (`menuFulfilmentMode`
 * defaults to pickup in the database, which says nothing), then the saved one.
 */
export function initialHandoverMode(input: { mode: HandoverMode; answered: boolean }): HandoverMode | null {
  return input.answered ? input.mode : null;
}

export function offersDelivery(mode: HandoverMode | null): boolean {
  return mode === "DELIVERY" || mode === "BOTH";
}

export function offersPickup(mode: HandoverMode | null): boolean {
  return mode === "PICKUP" || mode === "BOTH";
}

/**
 * The delivery fee field's first value: empty until delivery has been offered
 * (so "free" is typed, never a default), then the saved fee.
 */
export function initialFeeInput(feePaise: number, mode: HandoverMode, answered: boolean): string {
  if (!answered || !offersDelivery(mode)) return "";
  return String(paiseToRupees(feePaise));
}

/**
 * Why step 5 can't be saved yet. `feePaise` is the parsed fee field
 * (`deliveryFeeInputToPaise`): delivery needs one, 0 included.
 */
export function handoverProblems(input: {
  mode: HandoverMode | null;
  feePaise: number | null | undefined;
}): { mode?: string; fee?: string } {
  if (!input.mode) return { mode: "Choose how customers get their order." };
  if (offersDelivery(input.mode) && (input.feePaise === null || input.feePaise === undefined)) {
    return { fee: "Enter your delivery fee, up to ₹1,000, like 30. Enter 0 for free delivery." };
  }
  return {};
}

// ── Step 6: contact and alerts ──

export type ContactInput = {
  whatsapp: string;
  acceptWhatsappOrders: boolean;
  showWhatsappOnStore: boolean;
  instagram: string;
  /** Asked of food stores only; "" for the rest. */
  fssai: string;
};

/** An Indian mobile as PATCH /api/vendor stores it (E.164), or null. Landlines and short codes are not. */
export function indianMobileE164(raw: string): string | null {
  const n = normaliseIndianMobile(raw);
  return /^\+91[6-9]\d{9}$/.test(n) ? n : null;
}

export type ContactErrors = { wa?: string; instagram?: string; fssai?: string };

/** Field errors for step 6, keyed by input id; `{}` when it can be saved. Every field is optional. */
export function contactProblems(c: ContactInput): ContactErrors {
  const errors: ContactErrors = {};
  const wa = c.whatsapp.trim();
  if (wa && !indianMobileE164(wa)) {
    errors.wa = "Enter a 10-digit Indian mobile number, or leave this empty.";
  } else if (!wa && (c.acceptWhatsappOrders || c.showWhatsappOnStore)) {
    errors.wa = "Add your WhatsApp number, or turn off the switches below.";
  }
  if (normaliseInstagramHandle(c.instagram) === null) errors.instagram = INSTAGRAM_HANDLE_MESSAGE;
  const fssai = c.fssai.trim();
  if (fssai && !FSSAI_NUMBER_PATTERN.test(fssai)) errors.fssai = FSSAI_NUMBER_MESSAGE;
  return errors;
}

/**
 * The PATCH /api/vendor fields for step 6, from input that passed
 * `contactProblems`. A cleared field is sent only when something was saved,
 * so an untouched blank writes nothing.
 */
export function contactPatch(
  c: ContactInput,
  saved: { whatsapp: string; instagram: string; fssai: string },
  kind: StoreKind,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    acceptWhatsappOrders: c.acceptWhatsappOrders,
    showWhatsappOnStore: c.showWhatsappOnStore,
  };
  const wa = c.whatsapp.trim() ? indianMobileE164(c.whatsapp) : null;
  if (wa) body.whatsappNumber = wa;
  else if (saved.whatsapp) body.whatsappNumber = null;
  const ig = normaliseInstagramHandle(c.instagram) ?? "";
  if (ig || saved.instagram) body.instagramHandle = ig;
  if (kind === "food") {
    const fssai = c.fssai.trim();
    if (fssai || saved.fssai) body.fssaiNumber = fssai;
  }
  return body;
}

/**
 * Stores made before 2026-10 carry a database default for `Vendor.state`
 * ("Telangana") they never chose. Until step 1 is saved (no city yet) the
 * field starts empty; afterwards the saved value is the seller's own.
 */
export function initialStateName(city: string | null, state: string | null): string {
  return city?.trim() ? (state ?? "") : "";
}

/** Same ceilings as POST /api/menu/bulk (MENU_NAME_MAX, MENU_MAX_PRICE_PAISE in lib/zod-menu.ts). */
export const ITEM_NAME_MAX = 80;
export const ITEM_MAX_PRICE_PAISE = 10_000_000;
/** Rows the first-run form offers; the rest of the menu is added in Menu. */
export const MAX_DRAFT_ITEMS = 10;

export type ItemDraft = { key: string; name: string; priceRupees: string };

export type ItemDraftError = { name?: string; price?: string };

export function isBlankDraft(d: Pick<ItemDraft, "name" | "priceRupees">): boolean {
  return !d.name.trim() && !d.priceRupees.trim();
}

/** Errors for one typed row; `{}` when it can be saved. A blank row is not validated here. */
export function validateItemDraft(d: Pick<ItemDraft, "name" | "priceRupees">): ItemDraftError {
  const errors: ItemDraftError = {};
  const name = d.name.trim();
  if (!name) errors.name = "Enter the item's name.";
  else if (name.length > ITEM_NAME_MAX) errors.name = `Keep the name under ${ITEM_NAME_MAX} characters.`;

  const raw = d.priceRupees.trim();
  const price = Number(raw);
  if (!raw || !Number.isFinite(price) || price <= 0) {
    errors.price = "Enter a price in rupees, like 150.";
  } else {
    try {
      if (rupeesToPaise(price) > ITEM_MAX_PRICE_PAISE) errors.price = "That price looks too high.";
    } catch {
      errors.price = "Use at most 2 decimal places.";
    }
  }
  return errors;
}

/** Body rows for POST /api/menu/bulk. Call only on drafts that passed `validateItemDraft`. */
export function draftToBulkItem(d: Pick<ItemDraft, "name" | "priceRupees">): { name: string; priceInPaise: number } {
  return { name: d.name.trim(), priceInPaise: rupeesToPaise(Number(d.priceRupees.trim())) };
}
