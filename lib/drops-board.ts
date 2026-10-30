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
  name: string;
  qty: number;
  priceInPaise: number;
  totalPaise: number;
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
  notes: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  upiRef: string | null;
  /** Buyer attached a payment screenshot (lib/payment-proof.ts); absent = no. */
  hasPaymentProof?: boolean;
  subtotalPaise: number;
  /** Offer discount on this order (lib/offers.ts); absent or 0 when none. */
  discountPaise?: number;
  offerName?: string | null;
  deliveryFeePaise: number;
  totalPaise: number;
  /** Paid up front while the order is still unpaid; absent or 0 when none. */
  advancePaidPaise?: number;
  /** When the buyer wants it (ISO), for a menu order that has a date; null = none. */
  fulfilAt?: string | null;
  /** A demo store's sample order (lib/demo-store.ts). */
  isSample?: boolean;
  /** Handed to a rider (ISO), and who it went with; absent or null when not yet. */
  outForDeliveryAt?: string | null;
  riderName?: string | null;
  /** The rider's "Delivered" link token (/d/<token>); staff-only, delivery orders only. */
  riderToken?: string | null;
  /** When the buyer tapped "I've received my order" (ISO); null = not yet. */
  buyerReceivedAt?: string | null;
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

// ─── Filter buckets ─────────────────────────────────────────────────

export type BoardBucket = "needs_action" | "confirmed" | "delivered" | "closed";
export type BoardFilter = BoardBucket | "all";

export const BOARD_FILTERS: { id: BoardFilter; label: string }[] = [
  { id: "needs_action", label: "Needs action" },
  { id: "confirmed", label: "Confirmed" },
  { id: "delivered", label: "Delivered" },
  { id: "closed", label: "Cancelled / Expired" },
  { id: "all", label: "All" },
];

/**
 * Which tab an order lives under. "Needs action" = the vendor has something to
 * do: accept a new order, or check / chase a UPI payment (even on a confirmed
 * order — she still has to tick "paid").
 */
export function boardBucket(o: {
  displayState: OrderDisplayState;
  fulfilmentStatus: FulfilmentStatus | null;
}): BoardBucket {
  switch (o.displayState) {
    case "CANCELLED":
    case "EXPIRED":
      return "closed";
    case "DELIVERED":
      return "delivered";
    case "PAYMENT_SUBMITTED":
    case "AWAITING_PAYMENT":
      return "needs_action";
    default:
      return o.fulfilmentStatus === "PLACED" ? "needs_action" : "confirmed";
  }
}

export function filterOrders<T extends { bucket: BoardBucket }>(orders: T[], filter: BoardFilter): T[] {
  return filter === "all" ? orders : orders.filter((o) => o.bucket === filter);
}

export function countByFilter(orders: { bucket: BoardBucket }[]): Record<BoardFilter, number> {
  const out: Record<BoardFilter, number> = {
    needs_action: 0,
    confirmed: 0,
    delivered: 0,
    closed: 0,
    all: orders.length,
  };
  for (const o of orders) out[o.bucket] += 1;
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
  /** Orders that are live (not cancelled / expired). */
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
};

export function summarizeOrders(orders: SummaryInput[]): BoardSummary {
  const counts = Object.fromEntries(ORDER_DISPLAY_STATES.map((s) => [s, 0])) as Record<
    OrderDisplayState,
    number
  >;
  let paidPaise = 0;
  let pendingPaise = 0;
  let activeOrders = 0;
  for (const o of orders) {
    counts[o.displayState] += 1;
    if (o.displayState === "CANCELLED" || o.displayState === "EXPIRED") continue;
    activeOrders += 1;
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
  qtyOrdered: number;
  maxQty: number | null;
  /** null = unlimited. Same rule as `remainingQty` in lib/drops.ts (never negative). */
  remaining: number | null;
};

type PrepOrderInput = {
  holdsStock: boolean;
  displayState: OrderDisplayState;
  items: { dropItemId: string | null; qty: number }[];
};

/**
 * Quantity to cook per drop item: only orders that hold stock and are not
 * cancelled. Mirrors `soldQtyByDropItem`, so "remaining" here matches what the
 * storefront is enforcing. Order lines whose drop item was deleted are skipped
 * (they still appear on the packing list via the order itself).
 */
export function prepFromOrders(dropItems: PrepDropItem[], orders: PrepOrderInput[]): PrepRow[] {
  const qty = new Map<string, number>();
  for (const o of orders) {
    if (!o.holdsStock || o.displayState === "CANCELLED") continue;
    for (const it of o.items) {
      if (!it.dropItemId) continue;
      qty.set(it.dropItemId, (qty.get(it.dropItemId) ?? 0) + it.qty);
    }
  }
  return dropItems.map((d) => {
    const ordered = qty.get(d.id) ?? 0;
    return {
      dropItemId: d.id,
      name: d.name,
      emoji: d.emoji,
      qtyOrdered: ordered,
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
  "dispatch",
  "deliver",
  "undeliver",
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** Once orders are frozen the list is locked; only payment / handover bookkeeping remains. */
const FROZEN_ALLOWED: ReadonlySet<OrderAction> = new Set<OrderAction>([
  "mark_paid",
  "reject_payment",
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
  },
): ActionCheck {
  if ((dropStatus === "FROZEN" || dropStatus === "FULFILLED") && !FROZEN_ALLOWED.has(action)) {
    return { ok: false, error: "drop_frozen" };
  }
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
 * is the one answer. Bulk selection (lib/order-bulk.ts)
 * builds on the same list, so the card and the bulk bar never disagree about
 * what an order can do.
 */
export function availableOrderActions(
  o: {
    fulfilmentStatus: FulfilmentStatus | null;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    displayState?: OrderDisplayState;
    fulfilmentType?: FulfilmentType | null;
    outForDeliveryAt?: string | null;
  },
  frozen: boolean,
): Set<OrderAction> {
  const fs = o.fulfilmentStatus;
  const live = fs === "PLACED" || fs === "CONFIRMED";
  const out = new Set<OrderAction>();
  if (fs === "PLACED" && !frozen && o.displayState !== "PAYMENT_SUBMITTED") out.add("confirm");
  if (fs !== "CANCELLED" && o.paymentStatus !== "PAID" && (o.paymentMethod !== "CASH" || fs === "DELIVERED")) {
    out.add("mark_paid");
  }
  if (o.displayState === "PAYMENT_SUBMITTED") out.add("reject_payment");
  if (live && o.fulfilmentType === "DELIVERY" && !o.outForDeliveryAt) out.add("dispatch");
  if (live) out.add("deliver");
  if (fs === "DELIVERED") out.add("undeliver");
  if (live && !frozen) out.add("cancel");
  return out;
}

type CardOrder = Parameters<typeof availableOrderActions>[0];

/**
 * The one button a card draws as its next step; every other action is outline.
 * Always one of `availableOrderActions`, so it can never offer something the
 * card (or the bulk bar) would not:
 *   - a buyer's "I've paid" claim is waiting → answer it ("Payment received",
 *     which also confirms a new order);
 *   - a new order → "Confirm";
 *   - a confirmed order → hand it over ("Delivered" / "… collected");
 *   - handed over but still unpaid → "Payment received".
 */
export function primaryOrderAction(o: CardOrder, frozen: boolean): OrderAction | null {
  const actions = availableOrderActions(o, frozen);
  if (o.displayState === "PAYMENT_SUBMITTED" && actions.has("mark_paid")) return "mark_paid";
  if (actions.has("confirm")) return "confirm";
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

export const DROP_STATUS_LABEL: Record<EffectiveDropStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Opens later",
  OPEN: "Taking orders",
  CLOSED: "Orders closed",
  FROZEN: "Orders locked",
  FULFILLED: "Done",
};

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

/** Ids present in `next` but not in `prev` — "new order" detection after a refetch. */
export function newOrderIds(prev: { id: string }[], next: { id: string }[]): string[] {
  const seen = new Set(prev.map((o) => o.id));
  return next.filter((o) => !seen.has(o.id)).map((o) => o.id);
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
