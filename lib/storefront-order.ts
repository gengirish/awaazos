/**
 * Pure helpers for the buyer side of Drops (public storefront ordering).
 *
 * Client-safe: no Prisma, no Node APIs — `components/storefront/*` imports this
 * directly. Server-only rules (stock, locking, totals) live in lib/drops.ts.
 */

import type { FulfilmentStatus } from "@prisma/client";

import { formatINR } from "@/lib/currency";

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

// ─── Everyday menu visibility ───────────────────────────────────────

/**
 * Which `MenuItem`s the public storefront offers: available today AND not
 * kept counter-only by the vendor (`showOnline = false`). Shared by the page
 * and its OG card; the order write path (lib/menu-orders.ts `placeMenuOrder`)
 * applies the same two flags.
 */
export const STOREFRONT_MENU_ITEM_WHERE = { isAvailable: true, showOnline: true } as const;

export type MenuHidingDrop = {
  status: string;
  opensAt: Date | null;
  closesAt: Date;
  showEverydayMenu: boolean;
};

/**
 * True when a drop is taking orders right now with `showEverydayMenu = false`
 * — the storefront then shows only the drop(s). SCHEDULED and past-cut-off
 * drops never hide the menu.
 *
 * In-memory twin of lib/menu-orders.ts `everydayMenuHiddenByDrop` (which the
 * menu-order write path uses to refuse with `menu_paused_for_drop`); "taking
 * orders" is lib/drops.ts `effectiveDropStatus(...) === "OPEN"`, inlined
 * because this module is client-safe and lib/drops.ts imports Prisma.
 * Keep all three in lockstep.
 */
export function everydayMenuHiddenByDrops(drops: readonly MenuHidingDrop[], now: Date = new Date()): boolean {
  const t = now.getTime();
  return drops.some(
    (d) =>
      !d.showEverydayMenu &&
      d.status === "OPEN" &&
      t < d.closesAt.getTime() &&
      (!d.opensAt || t >= d.opensAt.getTime()),
  );
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

/** DOM id of an everyday-menu row, so a sold-out drop item can link to it. */
export function menuItemAnchor(menuItemId: string): string {
  return `menu-item-${menuItemId}`;
}

/**
 * True while at least one item in a drop can still be ordered (`null` =
 * unlimited). An open drop whose every item is sold out must not drive the
 * "Pre-order now" CTA or a countdown: there is nothing left to pre-order.
 */
export function dropHasStock(items: readonly { remaining: number | null }[]): boolean {
  return items.some((i) => i.remaining === null || i.remaining > 0);
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

// ─── Cart persistence (device-local) ────────────────────────────────

/** A saved cart older than this is discarded on restore. */
export const CART_TTL_MS = 24 * 60 * 60 * 1000;

export type CartScope = { kind: "menu" } | { kind: "drop"; dropId: string };

/**
 * localStorage key for one store's cart: `awz-cart:<slug>:menu` or
 * `awz-cart:<slug>:drop:<dropId>`. Holds item ids + quantities only — never
 * buyer details.
 */
export function cartStorageKey(slug: string, scope: CartScope): string {
  return scope.kind === "menu" ? `awz-cart:${slug}:menu` : `awz-cart:${slug}:drop:${scope.dropId}`;
}

export type StoredCart = { savedAt: number; lines: Record<string, number> };

/** Keeps positive integer quantities only. */
function cleanLines(lines: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(lines)) {
    if (!id || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    out[id] = qty;
  }
  return out;
}

/** Cart → JSON for storage, or null when there is nothing worth saving. */
export function serializeCart(cart: Record<string, number>, savedAt: number): string | null {
  const lines = cleanLines(cart);
  if (Object.keys(lines).length === 0) return null;
  return JSON.stringify({ v: 1, savedAt, lines });
}

/**
 * Stored JSON → cart, or null when missing, malformed, from a future
 * version, or older than `CART_TTL_MS`.
 */
export function parseStoredCart(raw: string | null, now: number): StoredCart | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { v?: unknown; savedAt?: unknown; lines?: unknown };
  if (o.v !== 1 || typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null;
  if (!o.lines || typeof o.lines !== "object" || Array.isArray(o.lines)) return null;
  // A savedAt in the future (clock change) counts as fresh, not as forever.
  const age = now - o.savedAt;
  if (age > CART_TTL_MS || age < -CART_TTL_MS) return null;
  return { savedAt: o.savedAt, lines: cleanLines(o.lines as Record<string, unknown>) };
}

/**
 * How many fresh, non-empty carts this device still holds for one store, from
 * localStorage `[key, raw]` entries. The order page uses it to point a buyer
 * back at a second cart (drop + menu) after placing the first; the placed
 * order's own cart is cleared before navigation, so it never counts.
 */
export function countStoredCarts(
  entries: readonly (readonly [string, string | null])[],
  slug: string,
  now: number,
): number {
  const prefix = `awz-cart:${slug}:`;
  let n = 0;
  for (const [key, raw] of entries) {
    if (!key.startsWith(prefix)) continue;
    const cart = parseStoredCart(raw, now);
    if (cart && Object.keys(cart.lines).length > 0) n++;
  }
  return n;
}

/**
 * Re-validates a restored cart against what the page offers now. `maxFor`
 * returns the most the buyer may order of an item (stock / per-order limit),
 * or null when the item is gone or unavailable. Lines are dropped at 0 and
 * clamped to `maxFor` and the schema ceiling.
 */
export function restoreCartLines(
  lines: Record<string, number>,
  maxFor: (id: string) => number | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(cleanLines(lines))) {
    const max = maxFor(id);
    if (max === null) continue;
    const q = Math.min(qty, max, MAX_LINE_QTY);
    if (q >= 1) out[id] = q;
  }
  return out;
}

/** True when two carts hold the same lines (order-insensitive). */
export function sameCartLines(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

// ─── Remembered buyer details (opt-in, device-local) ────────────────

export type SavedBuyer = {
  name: string;
  phone: string;
  address: string;
  fulfilment: "DELIVERY" | "PICKUP" | null;
  /** ms epoch of the last save; 0 for entries written before it existed. */
  savedAt: number;
};

/** Tolerant parse of the "remember my details" entry; null when absent or unreadable. */
export function parseSavedBuyer(raw: string | null): SavedBuyer | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  return {
    name: str(o.name),
    phone: str(o.phone),
    address: str(o.address),
    fulfilment: o.fulfilment === "DELIVERY" || o.fulfilment === "PICKUP" ? o.fulfilment : null,
    savedAt: typeof o.savedAt === "number" && Number.isFinite(o.savedAt) ? o.savedAt : 0,
  };
}

// ─── Checkout validation ────────────────────────────────────────────

export type CheckoutField = "name" | "phone" | "address" | "payment";
export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

/** Visual order of the fields in the checkout sheet — first invalid one gets focus. */
export const CHECKOUT_FIELD_ORDER: readonly CheckoutField[] = ["name", "phone", "address", "payment"];

export const CHECKOUT_FIELD_MESSAGES: Record<CheckoutField, string> = {
  name: "Please enter your name.",
  phone: "Enter a valid 10-digit +91 mobile number.",
  address: "Please enter a delivery address.",
  payment: "Please choose how you'll pay.",
};

/** "98765 43210", "+91 98765-43210", "919876543210" → true for a 6–9-leading 10-digit mobile. */
export function looksLikeIndianMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local);
}

export type CheckoutInput = {
  name: string;
  phone: string;
  address: string;
  fulfilment: "DELIVERY" | "PICKUP";
  method: "UPI" | "CASH" | null;
};

/** One field's client-side error, or null when it is valid (address only counts for delivery). */
export function validateCheckoutField(field: CheckoutField, input: CheckoutInput): string | null {
  switch (field) {
    case "name":
      return input.name.trim() ? null : CHECKOUT_FIELD_MESSAGES.name;
    case "phone":
      return looksLikeIndianMobile(input.phone) ? null : CHECKOUT_FIELD_MESSAGES.phone;
    case "address":
      return input.fulfilment !== "DELIVERY" || input.address.trim() ? null : CHECKOUT_FIELD_MESSAGES.address;
    case "payment":
      return input.method ? null : CHECKOUT_FIELD_MESSAGES.payment;
  }
}

/** Every client-side error at once (empty object = valid). */
export function validateCheckout(input: CheckoutInput): CheckoutFieldErrors {
  const out: CheckoutFieldErrors = {};
  for (const f of CHECKOUT_FIELD_ORDER) {
    const msg = validateCheckoutField(f, input);
    if (msg) out[f] = msg;
  }
  return out;
}

/** First field (in visual order) that carries an error, or null. */
export function firstInvalidField(errors: CheckoutFieldErrors): CheckoutField | null {
  return CHECKOUT_FIELD_ORDER.find((f) => !!errors[f]) ?? null;
}

/** 409-style rejection codes that belong to one field rather than the whole order. */
export function checkoutFieldForErrorCode(code: string): CheckoutField | null {
  switch (code) {
    case "address_required":
      return "address";
    case "pay_on_delivery_disabled":
      return "payment";
    default:
      return null;
  }
}

const ISSUE_PATH_FIELD: Record<string, CheckoutField> = {
  customerName: "name",
  customerPhone: "phone",
  deliveryAddress: "address",
  paymentMethod: "payment",
};

/**
 * A 400's zod `issues` → field errors with the sheet's own wording. Returns
 * null when no issue maps to a field (the caller shows a banner instead).
 */
export function checkoutErrorsFromIssues(issues: unknown): CheckoutFieldErrors | null {
  if (!Array.isArray(issues)) return null;
  const out: CheckoutFieldErrors = {};
  for (const issue of issues) {
    const head = (issue as { path?: unknown } | null)?.path;
    const key = Array.isArray(head) ? head[0] : undefined;
    const field = typeof key === "string" ? ISSUE_PATH_FIELD[key] : undefined;
    if (field && !out[field]) out[field] = CHECKOUT_FIELD_MESSAGES[field];
  }
  return Object.keys(out).length > 0 ? out : null;
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
    case "menu_paused_for_drop":
      return "The everyday menu is paused while today's special menu is open. Order from the drop above.";
    case "address_required":
      return "Please enter a delivery address.";
    case "fulfilment_unavailable":
      return "That delivery option isn't available for this menu. Please pick another.";
    case "pay_on_delivery_disabled":
      return "Pay on delivery isn't available. Please pay by UPI.";
    case "monthly_txn_cap_reached":
    case "orders_paused":
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

/**
 * The vendor's WhatsApp number as buyers may see it, or null. Public pages
 * (`/s/[slug]`, `/s/[slug]/o/[token]`) must go through this: the number is only
 * shown once the vendor has opted in (`acceptWhatsappOrders`, default off) and
 * only when it makes a working wa.me link. Never `Vendor.phone`.
 */
export function buyerWhatsappNumber(
  settings: { acceptWhatsappOrders?: boolean | null; whatsappNumber?: string | null } | null | undefined,
): string | null {
  if (!settings?.acceptWhatsappOrders || !settings.whatsappNumber) return null;
  return whatsappChatLink(settings.whatsappNumber, "") ? settings.whatsappNumber : null;
}

export type WhatsAppOrderMessageInput = {
  vendorName: string;
  billNumber: string;
  items: { name: string; qty: number; totalPaise: number }[];
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: "UPI" | "CASH";
  fulfilmentType: "DELIVERY" | "PICKUP" | null;
  /** Only rendered for DELIVERY. */
  deliveryAddress: string | null;
  /** Drop orders: the drop title and its fulfilment window label. */
  dropTitle?: string | null;
  fulfilmentWindow?: string | null;
  customerName: string | null;
  notes: string | null;
  /** Absolute link to the buyer's order page; omitted when no base URL is configured. */
  orderUrl: string | null;
};

/**
 * The order as a message the buyer sends to the kitchen from their own
 * WhatsApp (tap-to-compose, TODO 3.2). Every amount comes from the saved
 * order, so the text matches what the kitchen sees on its board; the bill
 * number ties the chat to that order. The buyer is the sender, so their own
 * name, address and note are theirs to share — the phone is not repeated
 * (WhatsApp already shows it). Asterisks are WhatsApp bold; no emoji (some
 * clients render them as "�").
 */
export function formatWhatsAppOrderMessage(o: WhatsAppOrderMessageInput): string {
  const lines: string[] = [`Hi ${o.vendorName}, I'd like to order:`, ""];
  if (o.dropTitle) lines.push(`*${o.dropTitle}*`);
  for (const i of o.items) lines.push(`${i.qty} x ${i.name} - ${formatINR(i.totalPaise)}`);
  if (o.deliveryFeePaise > 0) lines.push(`Delivery fee - ${formatINR(o.deliveryFeePaise)}`);
  lines.push(`*Total: ${formatINR(o.totalPaise)}*`, "");

  if (o.fulfilmentType === "DELIVERY") {
    lines.push(o.deliveryAddress ? `Delivery to: ${o.deliveryAddress}` : "Delivery");
  } else if (o.fulfilmentType === "PICKUP") {
    lines.push("Pickup");
  }
  if (o.fulfilmentWindow) lines.push(`When: ${o.fulfilmentWindow}`);
  lines.push(`Payment: ${o.paymentMethod === "CASH" ? "Pay on delivery" : "UPI"}`);
  if (o.customerName) lines.push(`Name: ${o.customerName}`);
  if (o.notes) lines.push(`Note: ${o.notes}`);
  lines.push("", `Order ${o.billNumber}`);
  if (o.orderUrl) lines.push(o.orderUrl);
  return lines.join("\n");
}
