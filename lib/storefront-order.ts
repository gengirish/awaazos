/**
 * Pure helpers for the buyer side of Drops (public storefront ordering).
 *
 * Client-safe: no Prisma, no Node APIs — `components/storefront/*` imports this
 * directly. Server-only rules (stock, locking, totals) live in lib/drops.ts.
 */

import type { FulfilmentStatus } from "@prisma/client";

const IST = "Asia/Kolkata";

/** Schema ceiling on a single line's qty (storefrontOrderSchema: max 99). */
export const MAX_LINE_QTY = 99;

/** A drop past its cut-off keeps showing "Orders closed" for this long, then hides. */
export const CLOSED_DROP_GRACE_MS = 12 * 60 * 60 * 1000;

// ─── Drop visibility on the storefront ──────────────────────────────

export type StorefrontDropVisibility = "open" | "scheduled" | "closed" | "hidden";

/**
 * Maps a drop's effective status (lib/drops.ts `effectiveDropStatus`) to what the
 * public page does with it. Only stored-OPEN drops are queried, so CLOSED here
 * means "past its cut-off".
 */
export function storefrontDropVisibility(
  effective: string,
  closesAt: Date,
  now: Date = new Date(),
): StorefrontDropVisibility {
  if (effective === "OPEN") return "open";
  if (effective === "SCHEDULED") return "scheduled";
  if (effective === "CLOSED" && now.getTime() - closesAt.getTime() < CLOSED_DROP_GRACE_MS) {
    return "closed";
  }
  return "hidden";
}

// ─── Time labels ────────────────────────────────────────────────────

function istParts(d: Date): {
  ymd: string;
  weekday: string;
  dayMonth: string;
  time: string;
} {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const weekday = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "short",
  }).format(d);
  const dayMonth = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase();
  return { ymd, weekday, dayMonth, time };
}

/**
 * "today 9:00 pm" / "tomorrow 9:00 pm" / "Fri 9:00 pm" (within a week) /
 * "Fri 16 Oct, 9:00 pm" (further out). IST.
 */
export function formatIstDeadline(d: Date, now: Date = new Date()): string {
  const p = istParts(d);
  const today = istParts(now).ymd;
  const tomorrow = istParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)).ymd;
  if (p.ymd === today) return `today ${p.time}`;
  if (p.ymd === tomorrow) return `tomorrow ${p.time}`;
  const diff = d.getTime() - now.getTime();
  if (diff > 0 && diff < 6 * 24 * 60 * 60 * 1000) return `${p.weekday} ${p.time}`;
  return `${p.weekday} ${p.dayMonth}, ${p.time}`;
}

/** "2 h 15 min left" / "45 min left" / null when past or more than 2 days away. */
export function formatTimeLeft(until: Date, now: Date = new Date()): string | null {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0 || ms > 48 * 60 * 60 * 1000) return null;
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min left`;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}

/** Whole minutes left on an unpaid order's stock hold (0 when lapsed). */
export function holdMinutesLeft(createdAt: Date, holdMinutes: number, now: Date = new Date()): number {
  const ms = createdAt.getTime() + holdMinutes * 60_000 - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

// ─── Cart limits ────────────────────────────────────────────────────

/** Most a buyer may put in the cart for one item. `remaining` null = unlimited. */
export function maxOrderableQty(remaining: number | null, perOrderLimit: number | null): number {
  let max = MAX_LINE_QTY;
  if (remaining !== null) max = Math.min(max, remaining);
  if (perOrderLimit !== null) max = Math.min(max, perOrderLimit);
  return Math.max(0, max);
}

/** "Only 3 left" when stock is low, "Sold out" at zero, else null. */
export function stockLabel(remaining: number | null, lowThreshold = 5): string | null {
  if (remaining === null) return null;
  if (remaining <= 0) return "Sold out";
  if (remaining <= lowThreshold) return `Only ${remaining} left`;
  return null;
}

// ─── Everyday-menu ordering ─────────────────────────────────────────

/**
 * Cart (menuItemId → qty) → the `items` array storefrontMenuOrderSchema
 * accepts: drops empty / non-integer lines, clamps to the schema ceiling.
 * Never carries a price — the server re-reads every price from MenuItem.
 */
export function toMenuOrderLines(cart: Record<string, number>): { menuItemId: string; qty: number }[] {
  const out: { menuItemId: string; qty: number }[] = [];
  for (const [menuItemId, qty] of Object.entries(cart)) {
    if (!menuItemId || !Number.isInteger(qty) || qty < 1) continue;
    out.push({ menuItemId, qty: Math.min(qty, MAX_LINE_QTY) });
  }
  return out;
}

/** "Delivery or pickup" / "Delivery only" / "Pickup only" for a fulfilment option list. */
export function fulfilmentOptionsLabel(types: readonly ("DELIVERY" | "PICKUP")[]): string {
  const delivery = types.includes("DELIVERY");
  const pickup = types.includes("PICKUP");
  if (delivery && pickup) return "Delivery or pickup";
  return delivery ? "Delivery only" : "Pickup only";
}

// ─── Order API error copy ───────────────────────────────────────────

export type OrderApiError = {
  error: string;
  dropItemId?: string;
  /** Set on menu-order (no drop) `item_not_found` rejections. */
  menuItemId?: string;
  remaining?: number;
  limit?: number;
};

/**
 * Buyer-facing copy for a failed checkout. `itemName` resolves `dropItemId` /
 * `menuItemId`. A rejection carrying `menuItemId` came from the everyday-menu
 * order path (app/api/s/[slug]/menu-orders), which has no drop to "close".
 */
export function orderErrorMessage(err: OrderApiError, itemName?: string): string {
  const name = itemName ?? "One item";
  switch (err.error) {
    case "sold_out":
      return err.remaining && err.remaining > 0
        ? `${name}: only ${err.remaining} left now. We've updated your cart — please check and try again.`
        : `${name} just sold out. We've removed it from your cart.`;
    case "per_order_limit":
      return `${name}: you can order at most ${err.limit ?? 1} per order.`;
    case "drop_not_open":
    case "drop_not_found":
      return "Orders for this menu have closed. Refresh to see what's available.";
    case "item_not_found":
      return err.menuItemId
        ? `${name} isn't available right now. We've removed it from your cart — please check and try again.`
        : `${name} is no longer on this menu. Please refresh and try again.`;
    case "menu_orders_disabled":
      return "This store has stopped taking online orders for now. Please order at the counter.";
    case "address_required":
      return "Please enter a delivery address.";
    case "fulfilment_unavailable":
      return "That delivery option isn't available for this menu. Please pick another.";
    case "pay_on_delivery_disabled":
      return "Pay on delivery isn't available. Please pay by UPI.";
    case "monthly_txn_cap_reached":
      return "This kitchen can't take online orders right now — message them directly.";
    case "rate_limited":
      return "Too many attempts. Please wait a minute and try again.";
    case "in_progress":
      return "Your order is still being placed — please wait a few seconds.";
    case "invalid_input":
      return "Please check your details and try again.";
    default:
      return "Something went wrong placing your order. Please try again.";
  }
}

// ─── Order status labels ────────────────────────────────────────────

export type OrderDisplayStateName =
  | "CANCELLED"
  | "DELIVERED"
  | "PAID"
  | "PAY_ON_DELIVERY"
  | "PAYMENT_SUBMITTED"
  | "AWAITING_PAYMENT"
  | "EXPIRED";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

/**
 * Text label (never colour alone) for the buyer's order page. `menuOrder`
 * (no drop) drops the stock wording — everyday-menu orders hold no stock.
 */
export function orderStatusLabel(
  state: OrderDisplayStateName,
  fulfilmentStatus: FulfilmentStatus | null,
  opts: { menuOrder?: boolean } = {},
): { label: string; hint: string | null; tone: StatusTone } {
  const confirmed = fulfilmentStatus === "CONFIRMED";
  switch (state) {
    case "CANCELLED":
      return { label: "Cancelled", hint: null, tone: "danger" };
    case "DELIVERED":
      return { label: "Delivered", hint: null, tone: "success" };
    case "EXPIRED":
      return {
        label: opts.menuOrder ? "Expired — please order again" : "Expired — items released, please order again",
        hint: null,
        tone: "neutral",
      };
    case "AWAITING_PAYMENT":
      return { label: "Waiting for payment", hint: null, tone: "warning" };
    case "PAYMENT_SUBMITTED":
      return confirmed
        ? {
            label: "Confirmed",
            hint: "Payment submitted — the kitchen will confirm",
            tone: "success",
          }
        : {
            label: "Payment submitted — the kitchen will confirm",
            hint: null,
            tone: "warning",
          };
    case "PAID":
      return confirmed
        ? { label: "Confirmed", hint: "Paid", tone: "success" }
        : { label: "Paid", hint: null, tone: "success" };
    case "PAY_ON_DELIVERY":
      return confirmed
        ? { label: "Confirmed", hint: "Pay on delivery", tone: "success" }
        : { label: "Pay on delivery", hint: null, tone: "neutral" };
  }
}

// ─── WhatsApp ───────────────────────────────────────────────────────

/**
 * wa.me click-to-chat link. A customer-initiated message is what opens the
 * kitchen's 24h WhatsApp service window. Returns null for unusable numbers.
 */
export function whatsappChatLink(number: string, text: string): string | null {
  let digits = number.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
