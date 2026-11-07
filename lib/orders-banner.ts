/**
 * The orders board's one banner slot: of the prompts a seller could be shown,
 * only the first eligible one is on screen, so they never stack above the
 * orders. Pure and client-safe; components/drops/orders/OrdersBannerSlot.tsx
 * reads the browser state.
 *
 * "Not now" is a snooze, kept per device in localStorage as the time it was
 * tapped, and nothing runs when it ends: the next render just sees it has lapsed.
 */
export type OrdersBanner = "reminder" | "polish" | "install" | "survey" | "refer";

/** Highest priority first. */
export const ORDERS_BANNER_PRIORITY: readonly OrdersBanner[] = ["reminder", "polish", "install", "survey", "refer"];

export const BANNER_SNOOZE_DAYS = 7;
/** The owner survey asks less often: "Not now" holds for 14 days, and it shows once per browser session. */
export const SURVEY_SNOOZE_DAYS = 14;
/** A dismissal that never lapses on this device: the one-time store polish nudge. */
export const DISMISS_FOR_GOOD = Number.POSITIVE_INFINITY;
const DAY_MS = 24 * 60 * 60 * 1000;

export function pickOrdersBanner(eligible: Record<OrdersBanner, boolean>): OrdersBanner | null {
  return ORDERS_BANNER_PRIORITY.find((banner) => eligible[banner]) ?? null;
}

/**
 * `stored` is the localStorage value: `Date.now()` as text when snoozed. A clock
 * moved back or an unreadable value counts as not snoozed, so a prompt can come
 * back early but is never hidden for good.
 */
export function isBannerSnoozed(stored: string | null, nowMs: number, days: number = BANNER_SNOOZE_DAYS): boolean {
  if (stored === null) return false;
  const snoozedAt = Number(stored);
  if (!Number.isFinite(snoozedAt)) return false;
  if (days === DISMISS_FOR_GOOD) return true;
  const elapsed = nowMs - snoozedAt;
  return elapsed >= 0 && elapsed < days * DAY_MS;
}

// ─── Store polish nudge ─────────────────────────────────────────────

/**
 * What a new store still shows buyers that reads as unfinished: items that are
 * plainly test rows ("Test item", "testing 2"), else no tagline under the store
 * name. One reason at a time, test items first, since buyers can order them.
 * Each reason is dismissed for good on the device, so the nudge is one-time.
 */
export type StorePolishNudge = { kind: "test_items"; names: string[] } | { kind: "no_tagline" };

const TEST_NAME = /\btest(?:s|ing)?\d*\b/i;

export function looksLikeTestName(name: string): boolean {
  return TEST_NAME.test(name);
}

export function storePolishNudge(store: {
  tagline: string | null | undefined;
  /** Names of the items buyers can see. */
  itemNames: readonly string[];
}): StorePolishNudge | null {
  const names = store.itemNames.filter(looksLikeTestName);
  if (names.length > 0) return { kind: "test_items", names };
  if (!store.tagline?.trim()) return { kind: "no_tagline" };
  return null;
}

/** The device's dismissal of one nudge reason (localStorage, `DISMISS_FOR_GOOD`). */
export function storePolishDismissKey(kind: StorePolishNudge["kind"]): string {
  return `awz_store_polish_dismissed_${kind}`;
}
