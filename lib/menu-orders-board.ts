/**
 * "Order from menu" board — pure, client-safe helpers (no Prisma, no node:*).
 *
 * Menu orders are storefront Transactions with `dropId = null`. They reuse the
 * drop board's BoardOrder shape, buckets and summary (lib/drops-board.ts);
 * what differs is the load window, the "To make" strip (no drop items, so
 * lines are grouped by their snapshot name) and the polling rule.
 */

import type { FulfilmentStatus } from "@prisma/client";

import type { OrderDisplayState } from "@/lib/drops";

// ─── Load window ────────────────────────────────────────────────────

/** Days of menu orders the board shows (today in IST + the 2 days before). */
export const MENU_BOARD_WINDOW_DAYS = 3;
/** Hard cap on rows per board load. Home-kitchen / stall volume is far below this. */
export const MENU_BOARD_MAX_ORDERS = 300;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The UTC instant at which the board's window opens: IST midnight
 * `MENU_BOARD_WINDOW_DAYS - 1` days before today (IST). IST has no DST, so a
 * fixed +05:30 offset is exact.
 */
export function menuBoardWindowStart(now: Date = new Date(), days: number = MENU_BOARD_WINDOW_DAYS): Date {
  const istWall = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightAsUtc = Date.UTC(istWall.getUTCFullYear(), istWall.getUTCMonth(), istWall.getUTCDate());
  return new Date(istMidnightAsUtc - (days - 1) * DAY_MS - IST_OFFSET_MS);
}

// ─── "To make" strip ────────────────────────────────────────────────

export type ToMakeRow = { name: string; qty: number };

type ToMakeOrderInput = {
  fulfilmentStatus: FulfilmentStatus | null;
  holdsStock: boolean;
  displayState: OrderDisplayState;
  items: { name: string; qty: number }[];
};

/**
 * Items × qty still to prepare: PLACED / CONFIRMED orders that hold stock
 * (so an expired unpaid UPI order doesn't make the vendor cook for nobody).
 * Grouped by the snapshot line name; biggest first, then A–Z.
 */
export function toMakeFromOrders(orders: ToMakeOrderInput[]): ToMakeRow[] {
  const qty = new Map<string, number>();
  for (const o of orders) {
    if (o.fulfilmentStatus !== "PLACED" && o.fulfilmentStatus !== "CONFIRMED") continue;
    if (!o.holdsStock || o.displayState === "CANCELLED") continue;
    for (const it of o.items) qty.set(it.name, (qty.get(it.name) ?? 0) + it.qty);
  }
  return Array.from(qty, ([name, q]) => ({ name, qty: q })).sort(
    (a, b) => b.qty - a.qty || a.name.localeCompare(b.name),
  );
}

// ─── Polling ────────────────────────────────────────────────────────

/**
 * Menu ordering has no cut-off, so this board can sit open on a stall's phone
 * all day. Every tick hits Postgres (requireVendorRole reads the user and its
 * memberships), so both intervals stay ABOVE Neon's 5-minute idle timeout —
 * anything shorter pins the database awake for as long as the tab is open
 * (global scale-to-zero rule). Faster alerts need a Postgres-free session
 * check on the signal route first; see TODO.md §3.5.
 */
export const MENU_SIGNAL_POLL_MS = 6 * 60_000;
/** No KV: refetch the orders list directly, at the same cadence. */
export const MENU_FALLBACK_POLL_MS = 6 * 60_000;

export type MenuPollKind = "signal" | "fallback" | null;

/**
 * Menu orders have no cut-off, so the only "stop" condition is the vendor's
 * setting: nothing polls while `acceptMenuOrders` is off. Visibility gating
 * happens in the component (ticks are skipped while the tab is hidden).
 */
export function menuBoardPollKind(acceptMenuOrders: boolean, signalMode: "kv" | "fallback"): MenuPollKind {
  if (!acceptMenuOrders) return null;
  return signalMode === "kv" ? "signal" : "fallback";
}

// ─── Settings guard ─────────────────────────────────────────────────

export type MenuOrdersBlocker = "storefront_not_published" | "no_payment_method";

/**
 * Why "Let customers order from your menu" can't be turned on, or null if it
 * can: buyers need a published storefront to order from, and a way to pay
 * (the vendor's UPI ID, or pay on delivery). Same rule on server and client.
 */
export function menuOrdersEnableBlocker(s: {
  publishStorefront: boolean;
  upiId: string | null | undefined;
  acceptPayOnDelivery: boolean;
}): MenuOrdersBlocker | null {
  if (!s.publishStorefront) return "storefront_not_published";
  if (!s.upiId?.trim() && !s.acceptPayOnDelivery) return "no_payment_method";
  return null;
}
