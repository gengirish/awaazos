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
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  displayState: OrderDisplayState;
  holdsStock: boolean;
  bucket: BoardBucket;
  items: BoardOrderItem[];
};

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

export const ORDER_ACTIONS = ["confirm", "mark_paid", "cancel", "deliver", "undeliver"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** Once orders are frozen the list is locked; only payment / handover bookkeeping remains. */
const FROZEN_ALLOWED: ReadonlySet<OrderAction> = new Set<OrderAction>(["mark_paid", "deliver", "undeliver"]);

export type ActionCheck = { ok: true } | { ok: false; error: "drop_frozen" | "invalid_state" };

/**
 * Pre-flight for a vendor action. The route still uses conditional
 * `updateMany` writes so a race between two phones cannot double-apply; this
 * just gives a clean 409 for the obvious cases.
 */
export function checkOrderAction(
  action: OrderAction,
  dropStatus: DropStatus,
  o: { fulfilmentStatus: FulfilmentStatus | null; paymentStatus: PaymentStatus },
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
      case "cancel":
        return fs === "PLACED" || fs === "CONFIRMED";
      case "deliver":
        return fs === "PLACED" || fs === "CONFIRMED";
      case "undeliver":
        return fs === "DELIVERED";
    }
  })();
  return ok ? { ok: true } : { ok: false, error: "invalid_state" };
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
  FROZEN: "Frozen (cooking)",
  FULFILLED: "Fulfilled",
};

/** Board polls the KV signal only while a drop can still receive orders. */
export function shouldPollForOrders(status: EffectiveDropStatus): boolean {
  return status === "OPEN" || status === "SCHEDULED";
}

/** Ids present in `next` but not in `prev` — "new order" detection after a refetch. */
export function newOrderIds(prev: { id: string }[], next: { id: string }[]): string[] {
  const seen = new Set(prev.map((o) => o.id));
  return next.filter((o) => !seen.has(o.id)).map((o) => o.id);
}

export const DISPLAY_STATE_LABEL: Record<OrderDisplayState, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PAYMENT_SUBMITTED: "Payment to check",
  PAY_ON_DELIVERY: "Pay on delivery",
  PAID: "Paid",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired (unpaid)",
};
