import type { DropStatus } from "@prisma/client";

/**
 * "Keep at least one way to pay" — pure, client-safe (no Prisma client, no node:*).
 *
 * Storefront buyers pay by the vendor's UPI ID or on delivery. Turning on
 * "Order from menu" and opening a drop already require one of them; this is the
 * other direction: the owner may not remove the last method while customers can
 * still order online. PATCH /api/vendor checks it against the values the request
 * leaves behind, and the payment settings UI maps the 409 to an inline message.
 */

export const LAST_PAYMENT_METHOD_ERROR = "last_payment_method" as const;

/** Why the last payment method can't go: the online ordering paths still on. */
export type PaymentGuardBlocker = "menu_orders" | "open_drop";

export type PaymentMethods = {
  upiId: string | null | undefined;
  acceptPayOnDelivery: boolean;
};

type DropState = { status: DropStatus; closesAt: Date };

export function hasPaymentMethod(s: PaymentMethods): boolean {
  return Boolean(s.upiId?.trim()) || s.acceptPayOnDelivery;
}

/**
 * A drop that takes orders now or will without another vendor action: stored
 * OPEN with its cut-off still ahead. That covers effective OPEN and SCHEDULED
 * (OPEN with a future `opensAt`) — both reach checkout on their own. Past the
 * cut-off it is effectively CLOSED (lib/drops.ts effectiveDropStatus).
 */
export function dropWillTakeOrders(drop: DropState, now: Date = new Date()): boolean {
  return drop.status === "OPEN" && now.getTime() < drop.closesAt.getTime();
}

/** Prisma `where` fragment matching `dropWillTakeOrders`; callers add `vendorId`. */
export function dropWillTakeOrdersWhere(now: Date = new Date()) {
  return { status: "OPEN" as const, closesAt: { gt: now } };
}

/**
 * What stops these payment settings from being saved: empty when at least one
 * payment method remains, or when no online ordering path is active.
 * `acceptMenuOrders` and the payment fields are the values *after* the change.
 */
export function lastPaymentMethodBlockers(
  s: PaymentMethods & { acceptMenuOrders: boolean; drops: DropState[] },
  now: Date = new Date(),
): PaymentGuardBlocker[] {
  if (hasPaymentMethod(s)) return [];
  const blockers: PaymentGuardBlocker[] = [];
  if (s.acceptMenuOrders) blockers.push("menu_orders");
  if (s.drops.some((d) => dropWillTakeOrders(d, now))) blockers.push("open_drop");
  return blockers;
}
