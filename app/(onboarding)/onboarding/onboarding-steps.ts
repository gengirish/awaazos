import { rupeesToPaise } from "@/lib/currency";

/**
 * Pure rules of the first-run setup (page.tsx), kept out of the page so they
 * are unit-tested. Client-safe: no Prisma, no React.
 *
 * Each step is saved when the seller taps Next, through the endpoints the rest
 * of the app uses (PATCH /api/vendor, POST /api/menu/bulk). Nothing marks "you
 * were on step N" in the database, so the step to reopen on is worked out from
 * what is saved (`resumeStep`), helped by a per-tab note in sessionStorage for
 * the steps a seller may skip.
 */

export const ONBOARDING_STEPS = [
  { title: "Your store", description: "Where you cook and sell from. You can change this later." },
  { title: "Getting paid", description: "Customers pay straight to your UPI ID. AwaazOS never holds your money." },
  { title: "What you sell", description: "One item with a price is enough to start. Add the rest later in Menu." },
  { title: "Order alerts", description: "Hear about a new order the moment it comes in." },
] as const;

export const STEP_COUNT = ONBOARDING_STEPS.length;

export type OnboardingResumeInput = {
  /** `Vendor.city`; null until step 1 has been saved. */
  city: string | null;
  upiId: string | null;
  /** Menu items the store already has. */
  itemCount: number;
  /** The step this tab last showed (sessionStorage), if any. */
  storedStep?: number | null;
};

/**
 * The step to open on. Step 1 is the only one that cannot be skipped, so an
 * unsaved step 1 always wins. Past it, the tab's own note is trusted (it tells
 * "skipped UPI" from "not there yet"); without one, the first step with
 * nothing saved.
 */
export function resumeStep({ city, upiId, itemCount, storedStep }: OnboardingResumeInput): number {
  if (!city?.trim()) return 1;
  if (storedStep != null && Number.isInteger(storedStep) && storedStep >= 1 && storedStep <= STEP_COUNT) {
    return storedStep;
  }
  if (!upiId?.trim()) return 2;
  if (itemCount <= 0) return 3;
  return 4;
}

/**
 * `Vendor.state` has a database default ("Telangana"), so a new store carries
 * it before anyone chose it. Until step 1 is saved (no city yet) the field
 * starts empty; afterwards the saved value is the seller's own.
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
