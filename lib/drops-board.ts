/**
 * Vendor orders board / prep sheet — pure, client-safe helpers.
 *
 * Nothing in here touches Prisma or `node:*`, so client components can import
 * it. Server code computes `displayState` and `holdsStock` with
 * `orderDisplayState` / `orderHoldsStock` from lib/drops.ts and passes them in;
 * this module only buckets, totals and groups.
 *
 * Money is integer paise throughout.
 */

import type {
  DropStatus,
  FulfilmentStatus,
  FulfilmentType,
  PaymentMethod,
  PaymentStatus,
} from "@prisma/client";

import type { EffectiveDropStatus, OrderDisplayState } from "@/lib/drops";
import { formatFulfilmentWindow } from "@/lib/drops-time";

export const ORDER_DISPLAY_STATES: readonly OrderDisplayState[] = [
  "AWAITING_PAYMENT",
  "PAYMENT_SUBMITTED",
  "PAY_ON_DELIVERY",
  "PAID",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type BoardOrderItem = {
  id: string;
  dropItemId: string | null;
  /** The catalogue item; null once it was deleted (the line keeps its snapshot name). */
  menuItemId?: string | null;
  name: string;
  qty: number;
  priceInPaise: number;
  totalPaise: number;
  /** A free-item offer's ₹0 gift line (lib/offers.ts). */
  isGift?: boolean;
};

/** One storefront order as the vendor board sees it (JSON-safe: dates are ISO strings). */
export type BoardOrder = {
  id: string;
  /** The drop this order belongs to, or null for an "order from menu" order. */
  dropId: string | null;
  billNumber: string;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  fulfilmentType: FulfilmentType | null;
  fulfilmentStatus: FulfilmentStatus | null;
  deliveryAddress: string | null;
  /** The area part of the address (lib/delivery-address.ts); null on older orders. */
  deliveryLocality?: string | null;
  notes: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  upiRef: string | null;
  /** Buyer attached a payment screenshot (lib/payment-proof.ts); absent = no. */
  hasPaymentProof?: boolean;
  /** Razorpay took this payment. Only whether it did: the payment id stays on the server. */
  paidOnline?: boolean;
  subtotalPaise: number;
  /** Offer discount on this order (lib/offers.ts); absent or 0 when none. */
  discountPaise?: number;
  offerName?: string | null;
  deliveryFeePaise: number;
  totalPaise: number;
  /** Paid up front while the order is still unpaid; absent or 0 when none. */
  advancePaidPaise?: number;
  /**
   * When the buyer wants it (ISO), for a menu order: the start of the slot they
   * picked (lib/menu-slots.ts), with `fulfilUntil` its end; a demo order may have
   * a single time. Null = none chosen. Drop orders use the drop's window.
   */
  fulfilAt?: string | null;
  fulfilUntil?: string | null;
  /** A demo store's sample order (lib/demo-store.ts). */
  isSample?: boolean;
  /** Packed and waiting for pickup ("Mark ready", ISO); absent or null when not yet. */
  readyAt?: string | null;
  /** Handed to a rider (ISO), and who it went with; absent or null when not yet. */
  outForDeliveryAt?: string | null;
  riderName?: string | null;
  /** The rider's "Delivered" link token (/d/<token>); staff-only, delivery orders only. */
  riderToken?: string | null;
  /** The buyer's own page (/s/<slug>/o/<token>), for messages the seller sends; staff-only. */
  buyerOrderPath?: string | null;
  /** When the buyer tapped "I've received my order" (ISO); null = not yet. */
  buyerReceivedAt?: string | null;
  /** The buyer's rating of this order; staff-only, the comment included. */
  feedback?: { rating: number; comment: string | null } | null;
  displayState: OrderDisplayState;
  holdsStock: boolean;
  bucket: BoardBucket;
  items: BoardOrderItem[];
};

/** What is still owed on an order with an advance; 0 once paid or without an advance. */
export function balanceDuePaise(o: Pick<BoardOrder, "paymentStatus" | "totalPaise" | "advancePaidPaise">): number {
  const advance = o.advancePaidPaise ?? 0;
  if (o.paymentStatus === "PAID" || advance <= 0) return 0;
  return Math.max(0, o.totalPaise - advance);
}

// ─── Stages (the board's tabs) ──────────────────────────────────────

/**
 * Where an order is in its life, one tab each: New → Preparing → Ready → Done.
 * `awaiting_online` has no tab and no count: it is listed at the end of New.
 */
export type BoardBucket = "new" | "preparing" | "ready" | "done" | "awaiting_online";
export type BoardFilter = Exclude<BoardBucket, "awaiting_online">;

export const BOARD_FILTERS: { id: BoardFilter; label: string }[] = [
  { id: "new", label: "New" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "done", label: "Done" },
];

/**
 * A new order on a Razorpay store that the buyer hasn't paid yet. There is nothing
 * for the seller to do: being paid confirms it by itself, and it lapses by itself.
 * An order the seller already confirmed isn't one of these, however it got there:
 * it holds stock until they mark it paid or cancel it, so it keeps its buttons.
 */
export function isAwaitingOnlinePay(o: {
  displayState: OrderDisplayState;
  fulfilmentStatus: FulfilmentStatus | null;
  onlineStore: boolean;
}): boolean {
  return o.onlineStore && o.displayState === "AWAITING_PAYMENT" && o.fulfilmentStatus === "PLACED";
}

/**
 * Which tab an order lives under. Payment is never a stage (the card shows it as
 * a badge): a confirmed order waiting for its UPI money is Preparing, a handed-over
 * one still unpaid is Done with "Payment due" (and in To collect).
 *   - New: not accepted yet, or the buyer says they paid and the seller hasn't answered.
 *   - Preparing: accepted.
 *   - Ready: packed for pickup (`readyAt`) or out for delivery (`outForDeliveryAt`).
 *   - Done: handed over, cancelled or expired.
 * `onlineStore`: the store takes Razorpay.
 */
export function boardBucket(o: {
  displayState: OrderDisplayState;
  fulfilmentStatus: FulfilmentStatus | null;
  onlineStore?: boolean;
  readyAt?: string | Date | null;
  outForDeliveryAt?: string | Date | null;
}): BoardBucket {
  if (isAwaitingOnlinePay({ ...o, onlineStore: o.onlineStore ?? false })) return "awaiting_online";
  switch (o.displayState) {
    case "CANCELLED":
    case "EXPIRED":
    case "DELIVERED":
      return "done";
    case "PAYMENT_SUBMITTED":
      return "new";
    default:
      if (o.fulfilmentStatus === "PLACED") return "new";
      return o.readyAt || o.outForDeliveryAt ? "ready" : "preparing";
  }
}

/** A tab's orders. New also lists the orders waiting for an online payment, last (nothing to do on them). */
export function filterOrders<T extends { bucket: BoardBucket }>(orders: T[], filter: BoardFilter): T[] {
  if (filter === "new") {
    return [...orders.filter((o) => o.bucket === "new"), ...orders.filter((o) => o.bucket === "awaiting_online")];
  }
  return orders.filter((o) => o.bucket === filter);
}

export function countByFilter(orders: { bucket: BoardBucket }[]): Record<BoardFilter, number> {
  const out: Record<BoardFilter, number> = { new: 0, preparing: 0, ready: 0, done: 0 };
  for (const o of orders) if (o.bucket !== "awaiting_online") out[o.bucket] += 1;
  return out;
}

// ─── Search and handover filter (client-side, over the loaded list) ──

/**
 * Orders matching what the vendor typed: part of the buyer's name, part of the
 * bill number, or digits from the end of the phone number (the last 4 is what
 * she reads off a UPI app or a call log). An empty query matches everything.
 */
export function searchOrders<
  T extends { customerName: string | null; customerPhone: string | null; billNumber: string },
>(orders: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  const digits = /^[\d\s+-]+$/.test(q) ? q.replace(/\D/g, "") : "";
  return orders.filter((o) => {
    if (o.customerName?.toLowerCase().includes(q)) return true;
    if (o.billNumber.toLowerCase().includes(q)) return true;
    if (!digits || !o.customerPhone) return false;
    const phone = o.customerPhone.replace(/\D/g, "");
    return digits.length >= 4 ? phone.endsWith(digits) : phone.slice(-4).includes(digits);
  });
}

export type HandoverFilter = "all" | "pickup" | "delivery";

/** Same split as `groupByFulfilment`: anything that is not a pickup is a delivery. */
export function filterByHandover<T extends { fulfilmentType: FulfilmentType | null }>(
  orders: T[],
  handover: HandoverFilter,
): T[] {
  if (handover === "all") return orders;
  return orders.filter((o) => (o.fulfilmentType === "PICKUP") === (handover === "pickup"));
}

// ─── Summary ────────────────────────────────────────────────────────

export type BoardSummary = {
  counts: Record<OrderDisplayState, number>;
  /** Orders still to finish: not delivered / picked up, cancelled or expired (New, Preparing and Ready). */
  activeOrders: number;
  /** Sum of totals already paid (excludes refunded / cancelled). */
  paidPaise: number;
  /** Sum of totals still to collect on live orders (UPI unpaid + pay-on-delivery). */
  pendingPaise: number;
};

type SummaryInput = {
  displayState: OrderDisplayState;
  paymentStatus: PaymentStatus;
  totalPaise: number;
  bucket?: BoardBucket;
};

/** Money nobody has committed yet isn't "to collect", so `awaiting_online` orders aren't counted. */
export function summarizeOrders(orders: SummaryInput[]): BoardSummary {
  const counts = Object.fromEntries(ORDER_DISPLAY_STATES.map((s) => [s, 0])) as Record<
    OrderDisplayState,
    number
  >;
  let paidPaise = 0;
  let pendingPaise = 0;
  let activeOrders = 0;
  for (const o of orders) {
    if (o.bucket === "awaiting_online") continue;
    counts[o.displayState] += 1;
    if (o.displayState === "CANCELLED" || o.displayState === "EXPIRED") continue;
    if (o.displayState !== "DELIVERED") activeOrders += 1;
    if (o.paymentStatus === "PAID") paidPaise += o.totalPaise;
    else pendingPaise += o.totalPaise;
  }
  return { counts, activeOrders, paidPaise, pendingPaise };
}

// ─── Prep / cook list ───────────────────────────────────────────────

export type PrepDropItem = {
  id: string;
  name: string;
  emoji: string | null;
  maxQty: number | null;
};

export type PrepRow = {
  dropItemId: string;
  name: string;
  emoji: string | null;
  /** Paid and free together: everything to cook. */
  qtyOrdered: number;
  /** How many of `qtyOrdered` are free-item gifts (lib/offers.ts). */
  qtyFree: number;
  maxQty: number | null;
  /** null = unlimited. Same rule as `remainingQty` in lib/drops.ts (never negative). */
  remaining: number | null;
};

type PrepOrderInput = {
  holdsStock: boolean;
  displayState: OrderDisplayState;
  items: { dropItemId: string | null; qty: number; isGift?: boolean }[];
};

/**
 * Quantity to cook per drop item: only orders that hold stock and are not
 * cancelled. A free-item gift is a line on the gift's own drop item, so it
 * counts in `qtyOrdered` and again in `qtyFree`. Mirrors `soldQtyByDropItem`, so "remaining" here matches what the
 * storefront is enforcing. Order lines whose drop item was deleted are skipped
 * (they still appear on the packing list via the order itself).
 */
export function prepFromOrders(dropItems: PrepDropItem[], orders: PrepOrderInput[]): PrepRow[] {
  const qty = new Map<string, number>();
  const free = new Map<string, number>();
  for (const o of orders) {
    if (!o.holdsStock || o.displayState === "CANCELLED") continue;
    for (const it of o.items) {
      if (!it.dropItemId) continue;
      qty.set(it.dropItemId, (qty.get(it.dropItemId) ?? 0) + it.qty);
      if (it.isGift) free.set(it.dropItemId, (free.get(it.dropItemId) ?? 0) + it.qty);
    }
  }
  return dropItems.map((d) => {
    const ordered = qty.get(d.id) ?? 0;
    return {
      dropItemId: d.id,
      name: d.name,
      emoji: d.emoji,
      qtyOrdered: ordered,
      qtyFree: free.get(d.id) ?? 0,
      maxQty: d.maxQty,
      remaining: d.maxQty === null ? null : Math.max(0, d.maxQty - ordered),
    };
  });
}

/** Orders that belong on the packing / delivery lists: holding and not cancelled. */
export function ordersToPack<T extends { holdsStock: boolean; displayState: OrderDisplayState }>(
  orders: T[],
): T[] {
  return orders.filter((o) => o.holdsStock && o.displayState !== "CANCELLED");
}

// ─── Handover (delivery / pickup list) ──────────────────────────────

export type HandoverDue =
  | { kind: "paid" }
  | { kind: "collect_cash"; amountPaise: number }
  | { kind: "unpaid_upi"; amountPaise: number };

export function handoverDue(o: {
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
}): HandoverDue {
  if (o.paymentStatus === "PAID") return { kind: "paid" };
  if (o.paymentMethod === "CASH") return { kind: "collect_cash", amountPaise: o.totalPaise };
  return { kind: "unpaid_upi", amountPaise: o.totalPaise };
}

export function groupByFulfilment<T extends { fulfilmentType: FulfilmentType | null }>(
  orders: T[],
): { delivery: T[]; pickup: T[] } {
  const delivery: T[] = [];
  const pickup: T[] = [];
  for (const o of orders) (o.fulfilmentType === "PICKUP" ? pickup : delivery).push(o);
  return { delivery, pickup };
}

// ─── Order actions ──────────────────────────────────────────────────

export const ORDER_ACTIONS = [
  "confirm",
  "mark_paid",
  "reject_payment",
  "cancel",
  "mark_ready",
  "unready",
  "dispatch",
  "deliver",
  "undeliver",
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** Once orders are frozen the list is locked; only payment / handover bookkeeping remains. */
const FROZEN_ALLOWED: ReadonlySet<OrderAction> = new Set<OrderAction>([
  "mark_paid",
  "reject_payment",
  "mark_ready",
  "unready",
  "dispatch",
  "deliver",
  "undeliver",
]);

export type ActionCheck = { ok: true } | { ok: false; error: "drop_frozen" | "invalid_state" };

/**
 * Pre-flight for a vendor action. The route still uses conditional
 * `updateMany` writes so a race between two phones cannot double-apply; this
 * just gives a clean 409 for the obvious cases.
 *
 * `dropStatus` is the *stored* status of the order's drop, or null for an
 * "order from menu" order (no drop, so no frozen rule).
 */
export function checkOrderAction(
  action: OrderAction,
  dropStatus: DropStatus | null,
  o: {
    fulfilmentStatus: FulfilmentStatus | null;
    paymentStatus: PaymentStatus;
    fulfilmentType?: FulfilmentType | null;
    /** `isAwaitingOnlinePay`: only cancel applies, so nothing holds its stock for good. */
    awaitingOnlinePay?: boolean;
  },
): ActionCheck {
  if ((dropStatus === "FROZEN" || dropStatus === "FULFILLED") && !FROZEN_ALLOWED.has(action)) {
    return { ok: false, error: "drop_frozen" };
  }
  if (o.awaitingOnlinePay && action !== "cancel") return { ok: false, error: "invalid_state" };
  const fs = o.fulfilmentStatus;
  const ok = (() => {
    switch (action) {
      case "confirm":
        return fs === "PLACED";
      case "mark_paid":
        return fs !== "CANCELLED" && o.paymentStatus !== "PAID";
      case "reject_payment":
        // Whether the buyer actually claimed is checked by the conditional write.
        return fs !== "CANCELLED" && o.paymentStatus === "PENDING";
      case "cancel":
        return fs === "PLACED" || fs === "CONFIRMED";
      case "mark_ready":
        // Packed and waiting; marking it again restamps.
        return fs === "PLACED" || fs === "CONFIRMED";
      case "unready":
        // Whether it was ready or out is checked by the conditional write.
        return fs === "CONFIRMED";
      case "dispatch":
        // Handing a delivery to a rider; sending it again (another rider) restamps it.
        return o.fulfilmentType === "DELIVERY" && (fs === "PLACED" || fs === "CONFIRMED");
      case "deliver":
        return fs === "PLACED" || fs === "CONFIRMED";
      case "undeliver":
        return fs === "DELIVERED";
    }
  })();
  return ok ? { ok: true } : { ok: false, error: "invalid_state" };
}

/**
 * The action buttons an order card offers. Stricter than `checkOrderAction`
 * in one place: an unpaid pay-on-delivery order is "marked paid" by the
 * "Delivered · ₹X collected" tap, so plain "Mark paid" only shows for it once
 * delivered. "Not received" (`reject_payment`) is only offered while the buyer's
 * "I've paid" claim is waiting for an answer, and then "Confirm" is not: being
 * marked paid confirms the order too (`markOrderPaid`), so "Payment received"
 * is the one answer. "Mark ready" is for an order the buyer collects (a delivery
 * goes "Out for delivery" instead); "Not ready" takes either stamp back. An
 * `awaiting_online` order offers only Cancel. Bulk selection
 * (lib/order-bulk.ts) builds on the same list, so the card and the bulk bar never
 * disagree about what an order can do.
 */
export function availableOrderActions(
  o: {
    fulfilmentStatus: FulfilmentStatus | null;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    displayState?: OrderDisplayState;
    fulfilmentType?: FulfilmentType | null;
    readyAt?: string | null;
    outForDeliveryAt?: string | null;
    /** The buyer tapped "I've received my order": the handover is the next step. */
    buyerReceivedAt?: string | null;
    bucket?: BoardBucket;
  },
  frozen: boolean,
): Set<OrderAction> {
  const fs = o.fulfilmentStatus;
  const live = fs === "PLACED" || fs === "CONFIRMED";
  const out = new Set<OrderAction>();
  if (o.bucket === "awaiting_online") {
    if (!frozen) out.add("cancel");
    return out;
  }
  if (fs === "PLACED" && !frozen && o.displayState !== "PAYMENT_SUBMITTED") out.add("confirm");
  if (fs !== "CANCELLED" && o.paymentStatus !== "PAID" && (o.paymentMethod !== "CASH" || fs === "DELIVERED")) {
    out.add("mark_paid");
  }
  if (o.displayState === "PAYMENT_SUBMITTED") out.add("reject_payment");
  if (live && o.fulfilmentType !== "DELIVERY" && !o.readyAt) out.add("mark_ready");
  if (fs === "CONFIRMED" && (o.readyAt || o.outForDeliveryAt)) out.add("unready");
  if (live && o.fulfilmentType === "DELIVERY" && !o.outForDeliveryAt) out.add("dispatch");
  if (live) out.add("deliver");
  if (fs === "DELIVERED") out.add("undeliver");
  if (live && !frozen) out.add("cancel");
  return out;
}

type CardOrder = Parameters<typeof availableOrderActions>[0];

/**
 * The one big button on a card: the next step of its stage. Always one of
 * `availableOrderActions`, so it can never offer something the card's menu (or
 * the bulk bar) would not:
 *   - a buyer's "I've paid" claim is waiting → answer it ("Yes, received",
 *     which also accepts a new order);
 *   - New → "Accept order";
 *   - Preparing → "Mark ready" (pickup) / "Out for delivery" (delivery);
 *   - Ready, or the buyer says it arrived → hand it over ("Picked up" /
 *     "Delivered", "… collected" for cash);
 *   - Done but still unpaid → "Payment received".
 */
export function primaryOrderAction(o: CardOrder, frozen: boolean): OrderAction | null {
  const actions = availableOrderActions(o, frozen);
  if (o.displayState === "PAYMENT_SUBMITTED" && actions.has("mark_paid")) return "mark_paid";
  if (actions.has("confirm")) return "confirm";
  if (o.buyerReceivedAt && actions.has("deliver")) return "deliver";
  if (actions.has("mark_ready")) return "mark_ready";
  if (actions.has("dispatch")) return "dispatch";
  if (actions.has("deliver")) return "deliver";
  if (actions.has("mark_paid")) return "mark_paid";
  return null;
}

/**
 * A single "Payment received" tap asks first unless the buyer has claimed the
 * payment: then the card already shows the claim (and the UTR) to check against.
 */
export function markPaidNeedsConfirm(o: { displayState: OrderDisplayState }): boolean {
  return o.displayState !== "PAYMENT_SUBMITTED";
}

// ─── One board, two kinds of order ──────────────────────────────────

/** What the board is showing: everything, only menu orders, or one drop (its id). */
export type BoardScope = "all" | "menu" | (string & {});

export function ordersInScope<T extends { dropId: string | null }>(orders: T[], scope: BoardScope): T[] {
  if (scope === "all") return orders;
  if (scope === "menu") return orders.filter((o) => o.dropId === null);
  return orders.filter((o) => o.dropId === scope);
}

/** The orders board narrowed to one drop. Every "orders of this drop" link and alert goes here. */
export function dropOrdersHref(dropId: string): string {
  return `/orders?drop=${encodeURIComponent(dropId)}`;
}

/** Stored FROZEN / FULFILLED: the drop's order list is locked (see `checkOrderAction`). */
export function isDropFrozen(status: DropStatus): boolean {
  return status === "FROZEN" || status === "FULFILLED";
}

/**
 * Where a vendor action on this order goes. The two route families keep their
 * own compound scope (`dropId` = this drop, or `dropId: null`), so the board
 * picks the family per order rather than one route accepting any order.
 */
export function orderActionBase(dropId: string | null): string {
  return dropId === null ? "/api/storefront-orders" : `/api/drops/${encodeURIComponent(dropId)}/orders`;
}

/** Split a bulk run by route family, keeping board order inside each group. */
export function groupIdsByDrop(orders: { id: string; dropId: string | null }[]): { dropId: string | null; ids: string[] }[] {
  const groups = new Map<string | null, string[]>();
  for (const o of orders) {
    const ids = groups.get(o.dropId);
    if (ids) ids.push(o.id);
    else groups.set(o.dropId, [o.id]);
  }
  return Array.from(groups, ([dropId, ids]) => ({ dropId, ids }));
}

// ─── Small display helpers ──────────────────────────────────────────

export function firstName(name: string | null | undefined): string {
  const n = name?.trim().split(/\s+/)[0];
  return n || "a customer";
}

/** wa.me wants digits only, country code included. */
export function whatsappHref(phoneE164: string, text?: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

/**
 * What the seller's WhatsApp button says to the buyer, by where the order is.
 * `ready` is the pickup message: there is no "ready" status, the seller just
 * says so. Holds the buyer's first name, so it only ever leaves the device
 * through the seller's own WhatsApp. An open-ended message stops mid-sentence
 * for the seller to finish, so it carries no link.
 */
export function buyerUpdateMessage(
  o: Pick<BoardOrder, "billNumber" | "customerName" | "fulfilmentType" | "fulfilmentStatus" | "outForDeliveryAt"> &
    Partial<Pick<BoardOrder, "fulfilAt" | "fulfilUntil">>,
  vendorName: string,
  orderUrl: string | null,
  ready = false,
): string {
  const name = o.customerName?.trim().split(/\s+/)[0] || "there";
  const order = `Hi ${name}, your order ${o.billNumber} from ${vendorName}`;
  const withLink = (text: string) => (orderUrl ? `${text}\nYour order: ${orderUrl}` : text);
  if (ready) return withLink(`${order} is ready for pickup.`);
  if (o.fulfilmentStatus === "CANCELLED") return `${order} has been cancelled: `;
  if (o.fulfilmentStatus === "DELIVERED") {
    return withLink(`${order} was ${o.fulfilmentType === "PICKUP" ? "picked up" : "delivered"}. Thank you!`);
  }
  if (o.fulfilmentStatus === "CONFIRMED") {
    if (o.outForDeliveryAt) return withLink(`${order} is on the way.`);
    // A menu order's slot, with its date: the buyer reads this later.
    const when = o.fulfilAt
      ? ` for ${formatFulfilmentWindow(new Date(o.fulfilAt), new Date(o.fulfilUntil ?? o.fulfilAt))}`
      : "";
    return withLink(`${order} is confirmed${when}.`);
  }
  return `Hi ${name}, about your order ${o.billNumber} from ${vendorName}: `;
}

/**
 * Client-side twin of `effectiveDropStatus` (lib/drops.ts can't be bundled for
 * the browser — it imports Prisma). Lets the board stop polling the moment the
 * cut-off passes without a refetch. Parity is enforced by a unit test.
 */
export function liveEffectiveStatus(
  drop: { status: DropStatus; opensAt: string | Date | null; closesAt: string | Date },
  now: Date = new Date(),
): EffectiveDropStatus {
  if (drop.status !== "OPEN") return drop.status;
  if (now.getTime() >= new Date(drop.closesAt).getTime()) return "CLOSED";
  if (drop.opensAt && now.getTime() < new Date(drop.opensAt).getTime()) return "SCHEDULED";
  return "OPEN";
}

/** Board polls the KV signal only while a drop can still receive orders. */
export function shouldPollForOrders(status: EffectiveDropStatus): boolean {
  return status === "OPEN" || status === "SCHEDULED";
}

export type BoardPollKind = "signal" | "fallback" | null;

/**
 * Whether the board checks for new orders on its own, and how. Nothing polls
 * unless a buyer could order right now: "order from menu" is on, or a drop is
 * open or about to open. Without KV the fallback refetches Postgres directly,
 * so it runs only while something is actually taking orders.
 */
export function boardPollKind(args: {
  acceptMenuOrders: boolean;
  dropStatuses: EffectiveDropStatus[];
  signalMode: "kv" | "fallback";
}): BoardPollKind {
  const { acceptMenuOrders, dropStatuses, signalMode } = args;
  if (signalMode === "kv") {
    return acceptMenuOrders || dropStatuses.some(shouldPollForOrders) ? "signal" : null;
  }
  return acceptMenuOrders || dropStatuses.includes("OPEN") ? "fallback" : null;
}

type ArrivingOrder = { id: string; bucket?: BoardBucket };

/**
 * "New order" detection after a refetch: ids in `next` but not in `prev`. An
 * `awaiting_online` order hasn't arrived yet. It arrives when it moves on (paid,
 * or the buyer says they paid), so a chime means money, and it lapsing is no news.
 */
export function newOrderIds(prev: ArrivingOrder[], next: ArrivingOrder[]): string[] {
  const before = new Map(prev.map((o) => [o.id, o.bucket]));
  return next
    .filter((o) => {
      if (o.bucket === "awaiting_online") return false;
      if (!before.has(o.id)) return true;
      return before.get(o.id) === "awaiting_online" && o.bucket !== "done";
    })
    .map((o) => o.id);
}

/** Where "N new orders — show" lands. An order paid online is already confirmed. */
export function newOrdersTab(unseen: { bucket: BoardBucket }[]): "new" | "preparing" {
  return unseen.length > 0 && unseen.every((o) => o.bucket === "preparing") ? "preparing" : "new";
}

export const DISPLAY_STATE_LABEL: Record<OrderDisplayState, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PAYMENT_SUBMITTED: "Customer says paid",
  PAY_ON_DELIVERY: "Pay on delivery",
  PAID: "Paid",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired (unpaid)",
};

export type PaymentBadgeKind = "paid" | "due" | "check" | "cash" | "unpaid" | "waiting_online" | "cancelled" | "expired";

/**
 * The payment badge on an order card. Payment is never a board stage, so this is
 * where it shows: words always, colour only repeats them. A handed-over order
 * still unpaid is "Payment due", the one that must not be forgotten.
 */
export function paymentBadge(o: {
  displayState: OrderDisplayState;
  paymentStatus: PaymentStatus;
  fulfilmentType: FulfilmentType | null;
  paidOnline?: boolean;
  bucket?: BoardBucket;
}): { kind: PaymentBadgeKind; label: string } {
  if (o.displayState === "CANCELLED") return { kind: "cancelled", label: "Cancelled" };
  if (o.displayState === "EXPIRED") return { kind: "expired", label: "Expired (unpaid)" };
  if (o.paymentStatus === "PAID") return { kind: "paid", label: o.paidOnline ? "Paid online" : "Paid" };
  if (o.displayState === "DELIVERED") return { kind: "due", label: "Payment due" };
  if (o.displayState === "PAYMENT_SUBMITTED") return { kind: "check", label: "Payment to check" };
  if (o.displayState === "PAY_ON_DELIVERY") {
    return { kind: "cash", label: o.fulfilmentType === "PICKUP" ? "Pay at pickup" : "Pay on delivery" };
  }
  if (o.bucket === "awaiting_online") return { kind: "waiting_online", label: "Waiting for online payment" };
  return { kind: "unpaid", label: "Not paid yet" };
}

/** `DISPLAY_STATE_LABEL`, except a handed-over pickup order reads "Picked up". */
export function orderStateLabel(o: {
  displayState: OrderDisplayState;
  fulfilmentType: FulfilmentType | null;
}): string {
  if (o.displayState === "DELIVERED" && o.fulfilmentType === "PICKUP") return "Picked up";
  return DISPLAY_STATE_LABEL[o.displayState];
}
