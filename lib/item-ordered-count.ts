/**
 * "Ordered 25+ times" on the store page (docs/PRODUCT_PAGE_PLAN.md step 5).
 * Pure and client-safe; the count itself comes from `loadOrderedCounts`
 * (lib/item-ordered-count-server.ts).
 *
 * 1. Counted per item over the last `ORDERED_WINDOW_DAYS` days: order lines whose
 *    order takes stock (every counter sale; a storefront order that holds stock,
 *    so not cancelled or lapsed), never samples, never free gifts.
 * 2. Shown in steps only (10+, 25+, 50+, 100+), never the exact number, nothing
 *    below 10. A step is a floor: 37 orders read "25+".
 * 3. Never on demo stores. Display only: it never sets `isPopular`, and nothing
 *    is stored. One read per page render, no cache, no timer.
 */

export const ORDERED_WINDOW_DAYS = 30;

export const ORDERED_STEPS = [100, 50, 25, 10] as const;
export type OrderedStep = (typeof ORDERED_STEPS)[number];

/** The step a count reaches; null below the lowest. */
export function orderedStep(count: number): OrderedStep | null {
  return ORDERED_STEPS.find((step) => count >= step) ?? null;
}

/** "Ordered 25+ times", or null when the count shows nothing. */
export function orderedBadgeText(count: number | null | undefined): string | null {
  const step = orderedStep(count ?? 0);
  return step === null ? null : `Ordered ${step}+ times`;
}
