/**
 * The orders board's one banner slot: of the prompts a seller could be shown,
 * only the first eligible one is on screen, so they never stack above the
 * orders. Pure and client-safe; components/drops/orders/OrdersBannerSlot.tsx
 * reads the browser state.
 *
 * "Not now" is a snooze, kept per device in localStorage as the time it was
 * tapped, and nothing runs when it ends: the next render just sees it has lapsed.
 */
export type OrdersBanner = "reminder" | "install" | "survey" | "refer";

/** Highest priority first. */
export const ORDERS_BANNER_PRIORITY: readonly OrdersBanner[] = ["reminder", "install", "survey", "refer"];

export const BANNER_SNOOZE_DAYS = 7;
const BANNER_SNOOZE_MS = BANNER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;

export function pickOrdersBanner(eligible: Record<OrdersBanner, boolean>): OrdersBanner | null {
  return ORDERS_BANNER_PRIORITY.find((banner) => eligible[banner]) ?? null;
}

/**
 * `stored` is the localStorage value: `Date.now()` as text when snoozed. A clock
 * moved back or an unreadable value counts as not snoozed, so a prompt can come
 * back early but is never hidden for good.
 */
export function isBannerSnoozed(stored: string | null, nowMs: number): boolean {
  if (stored === null) return false;
  const snoozedAt = Number(stored);
  if (!Number.isFinite(snoozedAt)) return false;
  const elapsed = nowMs - snoozedAt;
  return elapsed >= 0 && elapsed < BANNER_SNOOZE_MS;
}
