/**
 * Bulk actions on storefront orders — pure, client-safe helpers shared by the
 * board's selection bar (components/drops/orders/OrdersBoard.tsx) and the bulk
 * routes (`POST /api/drops/[id]/orders/bulk`, `POST /api/storefront-orders/bulk`).
 * The board sends each selected order to its own route (`groupIdsByDrop`).
 *
 * Bulk-eligible actions are the forward, everyday ones: confirm, mark paid,
 * deliver. Cancel (moves money back, vendor must refund by hand) and undeliver
 * (a one-off mistake fix) stay per-order on the card.
 *
 * Nothing in here touches Prisma, so client components can import it.
 */

import type { FulfilmentStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { z } from "zod";

import { availableOrderActions, type OrderAction } from "@/lib/drops-board";

export const BULK_ORDER_ACTIONS = ["confirm", "mark_paid", "deliver"] as const satisfies readonly OrderAction[];
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

export const BULK_ORDER_MAX = 50;

export const bulkOrderActionSchema = z.object({
  orderIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(BULK_ORDER_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: "orderIds must be unique" }),
  action: z.enum(BULK_ORDER_ACTIONS),
});

export type BulkOrderActionInput = z.infer<typeof bulkOrderActionSchema>;

/** Per-order failure codes. Unknown and cross-tenant ids are both `not_found`. */
export type BulkFailureCode = "not_found" | "drop_frozen" | "invalid_state" | "error";

export type BulkOrderResult = {
  succeeded: string[];
  failed: { id: string; error: BulkFailureCode }[];
};

type ActionableOrder = {
  id: string;
  fulfilmentStatus: FulfilmentStatus | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
};

/**
 * The frozen-drop rule for the orders at hand: one answer for all of them (a
 * single drop's list), or asked per order when the list mixes drops and menu
 * orders.
 */
export type FrozenRule<T> = boolean | ((o: T) => boolean);

function frozenFor<T>(rule: FrozenRule<T>, o: T): boolean {
  return typeof rule === "function" ? rule(o) : rule;
}

type MoneyOrder = { paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; totalPaise: number };

/** Bulk actions this order would accept right now (same rules as its card buttons). */
export function bulkActionsFor(o: Omit<ActionableOrder, "id">, frozen: boolean): BulkOrderAction[] {
  const all = availableOrderActions(o, frozen);
  return BULK_ORDER_ACTIONS.filter((a) => all.has(a));
}

/** Whether the order gets a selection checkbox at all. */
export function isBulkSelectable(o: Omit<ActionableOrder, "id">, frozen: boolean): boolean {
  return bulkActionsFor(o, frozen).length > 0;
}

/** Selected orders an action would apply to, in board order. Others are skipped, not sent. */
export function bulkTargets<T extends ActionableOrder>(
  orders: T[],
  selected: ReadonlySet<string>,
  action: BulkOrderAction,
  frozen: FrozenRule<T>,
): T[] {
  return orders.filter((o) => selected.has(o.id) && bulkActionsFor(o, frozenFor(frozen, o)).includes(action));
}

/** How many selected orders each bulk action would change — for the bar's button labels. */
export function bulkActionCounts<T extends ActionableOrder>(
  orders: T[],
  selected: ReadonlySet<string>,
  frozen: FrozenRule<T>,
): Record<BulkOrderAction, number> {
  const out: Record<BulkOrderAction, number> = { confirm: 0, mark_paid: 0, deliver: 0 };
  for (const o of orders) {
    if (!selected.has(o.id)) continue;
    for (const a of bulkActionsFor(o, frozenFor(frozen, o))) out[a] += 1;
  }
  return out;
}

/**
 * Drop ids that are no longer on screen or no longer actionable (after a
 * refetch, a filter change or a bulk run). Returns the same Set when nothing
 * changed so React can skip the re-render.
 */
export function pruneSelection<T extends ActionableOrder>(
  selected: ReadonlySet<string>,
  visible: T[],
  frozen: FrozenRule<T>,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const keep = new Set(visible.filter((o) => isBulkSelectable(o, frozenFor(frozen, o))).map((o) => o.id));
  let changed = false;
  const next = new Set<string>();
  selected.forEach((id) => {
    if (keep.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selected;
}

/** Cash the vendor says she collected when bulk-delivering unpaid pay-on-delivery orders. */
export function cashToCollectPaise(
  orders: MoneyOrder[],
): number {
  let sum = 0;
  for (const o of orders) if (o.paymentMethod === "CASH" && o.paymentStatus !== "PAID") sum += o.totalPaise;
  return sum;
}

/** Bulk mark-paid and cash-collecting delivery move money, so they ask first. */
export function bulkNeedsConfirm(
  action: BulkOrderAction,
  targets: MoneyOrder[],
): boolean {
  if (action === "mark_paid") return true;
  if (action === "deliver") return cashToCollectPaise(targets) > 0;
  return false;
}

const DONE_VERB: Record<BulkOrderAction, string> = {
  confirm: "confirmed",
  mark_paid: "marked paid", // new ones are confirmed too (markOrderPaid)
  deliver: "marked delivered",
};

function nOrders(n: number): string {
  return n === 1 ? "1 order" : `${n} orders`;
}

/** One toast line for a bulk run. `kind` picks success vs error styling. */
export function bulkResultMessage(
  action: BulkOrderAction,
  result: BulkOrderResult,
): { kind: "success" | "partial" | "error"; text: string } {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  if (bad === 0) return { kind: "success", text: `${nOrders(ok)} ${DONE_VERB[action]}` };
  const frozen = result.failed.some((f) => f.error === "drop_frozen");
  const reason = frozen
    ? "orders are locked"
    : result.failed.every((f) => f.error === "error")
      ? "try again"
      : "they changed on another device";
  if (ok === 0) return { kind: "error", text: `No orders changed (${reason}). Refreshed.` };
  return {
    kind: "partial",
    text: `${nOrders(ok)} ${DONE_VERB[action]}. ${nOrders(bad)} not changed (${reason}). Refreshed.`,
  };
}
