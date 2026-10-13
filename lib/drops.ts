/**
 * Drops — daily pre-order menus for home kitchens. Core rules, shared by the
 * vendor API, the public storefront and the payment paths.
 *
 * Three invariants live here and nowhere else:
 *
 *   1. **No timers.** A Drop's cut-off is evaluated lazily on every read and
 *      every order attempt (`effectiveDropStatus`). Nothing polls Postgres to
 *      flip OPEN → CLOSED, so Neon can scale to zero between orders.
 *
 *   2. **No overselling.** `placeStorefrontOrder` takes a row lock on the Drop
 *      (`SELECT … FOR UPDATE`), so concurrent orders for the same Drop serialise
 *      and the sold-count check cannot race. Home-kitchen volume is tens of
 *      orders per drop; per-drop serialisation costs nothing at that scale.
 *
 *   3. **Sold counts are derived, never stored.** An unpaid UPI order holds its
 *      stock for PENDING_HOLD_MINUTES, then silently stops counting. Cancelling
 *      frees stock. No counter to drift, no job to expire holds.
 *
 * Money is integer paise throughout. DailySummary is credited when a storefront
 * order is *paid*, not when it is placed — unpaid orders must not inflate
 * revenue.
 */

import { randomBytes } from "node:crypto";

import type {
  Drop,
  DropStatus,
  FulfilmentMode,
  FulfilmentStatus,
  FulfilmentType,
  PaymentMethod,
  PaymentStatus,
  Plan,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

import { formatBillDateYYYYMMDD, getIstMonthStart, getIstTodayStart } from "@/lib/billing-period";
import { PLAN_LIMITS } from "@/lib/constants";
import { sumPaise } from "@/lib/currency";
import { bumpDropOrderSignal } from "@/lib/drops-signal";
import { applyOffers } from "@/lib/offers";
import { loadResolvedOffers } from "@/lib/offers-server";
import { effectivePlan, isBillingLocked } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { notifyVendorInBackground, newOrderPayload } from "@/lib/push";
import { generateReceiptToken } from "@/lib/receipt-data";

type Db = PrismaClient | Prisma.TransactionClient;

/** How long an unpaid UPI order reserves stock before it stops counting. */
export const PENDING_HOLD_MINUTES = 15;

// ─── Status ─────────────────────────────────────────────────────────

export type EffectiveDropStatus = DropStatus | "SCHEDULED";

/**
 * The status buyers and the vendor should see *right now*. Stored status is
 * only ever moved by the vendor; time-based transitions are computed here.
 */
export function effectiveDropStatus(
  drop: Pick<Drop, "status" | "opensAt" | "closesAt">,
  now: Date = new Date(),
): EffectiveDropStatus {
  if (drop.status !== "OPEN") return drop.status;
  if (now.getTime() >= drop.closesAt.getTime()) return "CLOSED";
  if (drop.opensAt && now.getTime() < drop.opensAt.getTime()) return "SCHEDULED";
  return "OPEN";
}

export function isAcceptingOrders(
  drop: Pick<Drop, "status" | "opensAt" | "closesAt">,
  now: Date = new Date(),
): boolean {
  return effectiveDropStatus(drop, now) === "OPEN";
}

/** Fulfilment types a buyer may pick for a drop. */
export function allowedFulfilmentTypes(mode: FulfilmentMode): FulfilmentType[] {
  if (mode === "BOTH") return ["DELIVERY", "PICKUP"];
  return [mode];
}

/** Vendor-driven transitions. Time-driven ones (cut-off) are never stored. */
const ALLOWED_TRANSITIONS: Record<DropStatus, DropStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED", "FROZEN", "DRAFT"],
  CLOSED: ["OPEN", "FROZEN"],
  FROZEN: ["FULFILLED", "CLOSED"],
  FULFILLED: [],
};

/**
 * Can the vendor move `from` → `to`? Uses the *effective* status as `from`, so
 * an OPEN drop past its cut-off behaves as CLOSED (it can be frozen, or reopened
 * — reopening requires moving closesAt forward, which the caller enforces).
 */
export function canTransition(from: EffectiveDropStatus, to: DropStatus): boolean {
  const base: DropStatus = from === "SCHEDULED" ? "OPEN" : from;
  return ALLOWED_TRANSITIONS[base].includes(to);
}

// ─── Stock holds ────────────────────────────────────────────────────

/** Prisma filter: storefront orders that currently reserve stock. */
export function stockHoldingOrderWhere(now: Date = new Date()): Prisma.TransactionWhereInput {
  const holdCutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60_000);
  return {
    fulfilmentStatus: { not: "CANCELLED" },
    OR: [
      { paymentStatus: "PAID" },
      { paymentMethod: "CASH" }, // pay on delivery — vendor accepted the risk
      { upiRef: { not: null } }, // buyer submitted a UTR; awaiting vendor check
      { paymentClaimedAt: { not: null } }, // buyer tapped "I've paid"; awaiting vendor check
      { fulfilmentStatus: { in: ["CONFIRMED", "DELIVERED"] } },
      // Strictly after: at exactly PENDING_HOLD_MINUTES the hold has lapsed,
      // matching `orderHoldsStock` (`< hold`) and the EXPIRED display state.
      { createdAt: { gt: holdCutoff } },
    ],
  };
}

type HoldFields = {
  fulfilmentStatus: FulfilmentStatus | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  upiRef: string | null;
  /** Buyer's "I've paid" tap. Holds stock like a UTR until the vendor answers. */
  paymentClaimedAt: Date | null;
  createdAt: Date;
};

/** The buyer says they paid (tap or UTR) and the vendor has not answered yet. */
function hasPaymentClaim(o: Pick<HoldFields, "upiRef" | "paymentClaimedAt">): boolean {
  return !!o.upiRef || o.paymentClaimedAt !== null;
}

/** Pure twin of `stockHoldingOrderWhere` — keep the two in lockstep (tested). */
export function orderHoldsStock(o: HoldFields, now: Date = new Date()): boolean {
  if (o.fulfilmentStatus === "CANCELLED") return false;
  if (o.paymentStatus === "PAID") return true;
  if (o.paymentMethod === "CASH") return true;
  if (hasPaymentClaim(o)) return true;
  if (o.fulfilmentStatus === "CONFIRMED" || o.fulfilmentStatus === "DELIVERED") return true;
  return now.getTime() - o.createdAt.getTime() < PENDING_HOLD_MINUTES * 60_000;
}

export type OrderDisplayState =
  | "CANCELLED"
  | "DELIVERED"
  | "PAID"
  | "PAY_ON_DELIVERY"
  | "PAYMENT_SUBMITTED"
  | "AWAITING_PAYMENT"
  | "EXPIRED";

/** One label per order for boards and the buyer's order page. */
export function orderDisplayState(o: HoldFields, now: Date = new Date()): OrderDisplayState {
  if (o.fulfilmentStatus === "CANCELLED") return "CANCELLED";
  if (o.fulfilmentStatus === "DELIVERED") return "DELIVERED";
  if (o.paymentStatus === "PAID") return "PAID";
  if (o.paymentMethod === "CASH") return "PAY_ON_DELIVERY";
  if (hasPaymentClaim(o)) return "PAYMENT_SUBMITTED";
  return orderHoldsStock(o, now) ? "AWAITING_PAYMENT" : "EXPIRED";
}

/** dropItemId → quantity currently reserved by holding orders. */
export async function soldQtyByDropItem(
  db: Db,
  dropId: string,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const rows = await db.orderItem.groupBy({
    by: ["dropItemId"],
    where: {
      dropItem: { dropId },
      transaction: stockHoldingOrderWhere(now),
    },
    _sum: { qty: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.dropItemId) out.set(r.dropItemId, r._sum.qty ?? 0);
  }
  return out;
}

/** null maxQty = unlimited. Never negative (a vendor may lower maxQty below sold). */
export function remainingQty(maxQty: number | null, sold: number): number | null {
  if (maxQty === null) return null;
  return Math.max(0, maxQty - sold);
}

// ─── Totals ─────────────────────────────────────────────────────────

/**
 * `total = subtotal − discount + delivery fee`. The discount comes from
 * `applyOffers` (lib/offers.ts) and never touches the delivery fee.
 */
export function computeOrderTotals(
  lines: { priceInPaise: number; qty: number }[],
  deliveryFeePaise: number,
  discountPaise = 0,
): { subtotalPaise: number; totalPaise: number } {
  const subtotalPaise = sumPaise(lines.map((l) => l.priceInPaise * l.qty));
  return { subtotalPaise, totalPaise: subtotalPaise - discountPaise + deliveryFeePaise };
}

/** 32 url-safe chars, 192 bits. The buyer's order page is keyed on this alone. */
export function generateOrderToken(): string {
  return randomBytes(24).toString("base64url");
}

// ─── Plan usage ─────────────────────────────────────────────────────

/**
 * Transactions that are real sales: every counter sale (any status — it was
 * rung up), plus storefront orders only once they are paid. Unpaid, expired
 * and cancelled pre-orders (cancel of a paid order sets REFUNDED) are excluded.
 *
 * This is the one definition of "a bill" for the plan cap, the billing usage
 * line and analytics counts. Spread it into a `where` alongside `vendorId`;
 * it carries an `OR`, so don't combine it with another top-level `OR`.
 * `billableTxnSql` is its raw-SQL twin — keep the two in lockstep (tested).
 */
export function billableTxnWhere(): Prisma.TransactionWhereInput {
  return { OR: [{ source: { not: "STOREFRONT" } }, { paymentStatus: "PAID" }] };
}

/**
 * Raw-SQL twin of `billableTxnWhere`, for `$queryRaw`. Expects the
 * `transactions` table aliased as `t`.
 */
export const billableTxnSql = Prisma.sql`(t."source" <> 'STOREFRONT' OR t."paymentStatus" = 'PAID')`;

const IST_OFFSET_MS = 330 * 60_000;

/**
 * The instant the current IST month began (00:00 IST on the 1st). Unlike
 * `getIstMonthStart` — a `@db.Date` key at 00:00 UTC, i.e. 05:30 IST — this is
 * the right lower bound for a `createdAt` timestamp.
 */
export function istMonthStartInstant(now: Date = new Date()): Date {
  return new Date(getIstMonthStart(now).getTime() - IST_OFFSET_MS);
}

/**
 * Transactions that count toward the monthly plan cap (`billableTxnWhere`).
 * An abandoned pre-order must not burn a FREE vendor's 50.
 */
export async function countBillableTxnThisMonth(
  db: Db,
  vendorId: string,
  now: Date = new Date(),
): Promise<number> {
  return db.transaction.count({
    where: {
      vendorId,
      createdAt: { gte: istMonthStartInstant(now) },
      ...billableTxnWhere(),
    },
  });
}

/** Atomic per-(vendor, IST day) bill number, same sequence as counter sales. */
export async function nextBillNumber(
  tx: Prisma.TransactionClient,
  vendorId: string,
  now: Date = new Date(),
): Promise<string> {
  const today = getIstTodayStart(now);
  const seq = await tx.billSequence.upsert({
    where: { vendorId_date: { vendorId, date: today } },
    create: { vendorId, date: today, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return `AWZ-${formatBillDateYYYYMMDD(today)}-${String(seq.lastSeq).padStart(4, "0")}`;
}

// ─── Place order ────────────────────────────────────────────────────

export type PlaceOrderInput = {
  /**
   * Stored plan + raw expiry + trial end; the cap uses `effectivePlan()` and
   * a locked vendor takes no orders (lib/plan.ts). Omitting `planExpiresAt`
   * means "no expiry" and omitting `trialEndsAt` means "no trial" — always
   * pass both from a DB row.
   */
  vendor: { id: string; plan: Plan; planExpiresAt?: Date | null; trialEndsAt?: Date | null };
  acceptPayOnDelivery: boolean;
  dropId: string;
  items: { dropItemId: string; qty: number }[];
  customerName: string;
  customerPhone: string; // E.164, already validated
  fulfilmentType: FulfilmentType;
  deliveryAddress?: string | null;
  notes?: string | null;
  paymentMethod: "UPI" | "CASH";
  /** Signed-in storefront customer, if any (lib/customer-auth.ts). */
  customerId?: string | null;
  now?: Date;
};

export type PlaceOrderError =
  | { code: "drop_not_found" }
  | { code: "drop_not_open" }
  | { code: "item_not_found"; dropItemId: string }
  | { code: "sold_out"; dropItemId: string; remaining: number }
  | { code: "per_order_limit"; dropItemId: string; limit: number }
  | { code: "fulfilment_unavailable" }
  | { code: "address_required" }
  | { code: "pay_on_delivery_disabled" }
  | { code: "monthly_txn_cap_reached" }
  | { code: "orders_paused" };

export type PlacedOrder = {
  id: string;
  billNumber: string;
  orderToken: string;
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
};

export type PlaceOrderResult = { ok: true; order: PlacedOrder } | { ok: false; error: PlaceOrderError };

class OrderRejected extends Error {
  constructor(public readonly error: PlaceOrderError) {
    super(error.code);
  }
}

/** Merge duplicate lines for the same drop item ("2 laddu" tapped twice). */
export function mergeOrderLines(items: { dropItemId: string; qty: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.dropItemId, (merged.get(i.dropItemId) ?? 0) + i.qty);
  return Array.from(merged, ([dropItemId, qty]) => ({ dropItemId, qty }));
}

export async function placeStorefrontOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const now = input.now ?? new Date();
  const vendorId = input.vendor.id;
  const lines = mergeOrderLines(input.items);

  if (input.paymentMethod === "CASH" && !input.acceptPayOnDelivery) {
    return { ok: false, error: { code: "pay_on_delivery_disabled" } };
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Serialise all orders for this drop. Compound filter = tenant isolation.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM drops WHERE id = ${input.dropId} AND "vendorId" = ${vendorId} FOR UPDATE`;
      if (locked.length === 0) throw new OrderRejected({ code: "drop_not_found" });

      const drop = await tx.drop.findFirst({
        where: { id: input.dropId, vendorId },
        include: { items: { include: { menuItem: { select: { name: true } } } } },
      });
      if (!drop) throw new OrderRejected({ code: "drop_not_found" });
      if (!isAcceptingOrders(drop, now)) throw new OrderRejected({ code: "drop_not_open" });

      if (!allowedFulfilmentTypes(drop.fulfilmentMode).includes(input.fulfilmentType)) {
        throw new OrderRejected({ code: "fulfilment_unavailable" });
      }
      const address = input.deliveryAddress?.trim() || null;
      if (input.fulfilmentType === "DELIVERY" && !address) {
        throw new OrderRejected({ code: "address_required" });
      }

      const byId = new Map(drop.items.map((i) => [i.id, i]));
      const sold = await soldQtyByDropItem(tx, drop.id, now);

      const priced = lines.map((l) => {
        const item = byId.get(l.dropItemId);
        if (!item) throw new OrderRejected({ code: "item_not_found", dropItemId: l.dropItemId });
        if (item.perOrderLimit !== null && l.qty > item.perOrderLimit) {
          throw new OrderRejected({
            code: "per_order_limit",
            dropItemId: item.id,
            limit: item.perOrderLimit,
          });
        }
        const remaining = remainingQty(item.maxQty, sold.get(item.id) ?? 0);
        if (remaining !== null && l.qty > remaining) {
          throw new OrderRejected({ code: "sold_out", dropItemId: item.id, remaining });
        }
        return { item, qty: l.qty };
      });

      const planFields = {
        plan: input.vendor.plan,
        planExpiresAt: input.vendor.planExpiresAt ?? null,
        trialEndsAt: input.vendor.trialEndsAt ?? null,
      };
      // Trial over and not subscribed: the vendor can't take new orders. The
      // buyer is told the shop is paused, never why.
      if (isBillingLocked(planFields, now)) {
        throw new OrderRejected({ code: "orders_paused" });
      }
      const plan = effectivePlan(planFields, now);
      const cap = PLAN_LIMITS[plan].monthlyTxnCap;
      if (cap !== null && (await countBillableTxnThisMonth(tx, vendorId, now)) >= cap) {
        throw new OrderRejected({ code: "monthly_txn_cap_reached" });
      }

      // Offers are priced here, from this vendor's rows, inside the same
      // transaction: the buyer's browser never sends a price or a discount.
      const offers = await loadResolvedOffers(tx, vendorId, { channel: "DROP", dropId: drop.id, now });
      const offered = applyOffers(
        priced.map((p) => ({
          key: p.item.id,
          menuItemId: p.item.menuItemId,
          priceInPaise: p.item.priceInPaise,
          qty: p.qty,
        })),
        offers,
      );
      const discountByLine = new Map(offered.lines.map((l) => [l.key, l.discountPaise]));
      const appliedOffer = offered.discounts[0] ?? null;
      const discountPaise = offered.discountTotalPaise;

      const deliveryFeePaise = input.fulfilmentType === "DELIVERY" ? drop.deliveryFeePaise : 0;
      const { subtotalPaise, totalPaise } = computeOrderTotals(
        priced.map((p) => ({ priceInPaise: p.item.priceInPaise, qty: p.qty })),
        deliveryFeePaise,
        discountPaise,
      );

      const billNumber = await nextBillNumber(tx, vendorId, now);
      const orderToken = generateOrderToken();

      const created = await tx.transaction.create({
        data: {
          vendorId,
          billNumber,
          subtotalPaise,
          discountPaise,
          offerId: appliedOffer?.offerId ?? null,
          offerName: appliedOffer?.name ?? null,
          totalPaise,
          deliveryFeePaise,
          paymentMethod: input.paymentMethod,
          paymentStatus: "PENDING",
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone,
          source: "STOREFRONT",
          notes: input.notes?.trim() || null,
          dropId: drop.id,
          fulfilmentStatus: "PLACED",
          fulfilmentType: input.fulfilmentType,
          deliveryAddress: input.fulfilmentType === "DELIVERY" ? address : null,
          orderToken,
          customerId: input.customerId ?? null,
          orderItems: {
            create: priced.map((p) => ({
              menuItemId: p.item.menuItemId,
              dropItemId: p.item.id,
              name: p.item.menuItem.name, // snapshot
              priceInPaise: p.item.priceInPaise,
              qty: p.qty,
              totalPaise: p.item.priceInPaise * p.qty,
              discountPaise: discountByLine.get(p.item.id) ?? 0,
            })),
          },
        },
      });

      await tx.receipt.create({
        data: {
          transactionId: created.id,
          vendorId,
          receiptNumber: billNumber,
          whatsappSent: false,
          publicToken: generateReceiptToken(),
        },
      });

      return {
        id: created.id,
        billNumber,
        orderToken,
        subtotalPaise,
        discountPaise,
        deliveryFeePaise,
        totalPaise,
        paymentMethod: created.paymentMethod,
      } satisfies PlacedOrder;
    });

    // Fire-and-forget: lets the vendor's board notice without polling Postgres,
    // and pushes an alert to opted-in staff phones (lib/push.ts).
    void bumpDropOrderSignal(vendorId, input.dropId);
    notifyVendorInBackground(
      vendorId,
      newOrderPayload({
        billNumber: order.billNumber,
        totalPaise: order.totalPaise,
        itemCount: lines.reduce((n, l) => n + l.qty, 0),
        dropId: input.dropId,
      }),
    );
    return { ok: true, order };
  } catch (err) {
    if (err instanceof OrderRejected) return { ok: false, error: err.error };
    throw err;
  }
}

// ─── Payment + cancellation (keep DailySummary consistent) ──────────

/**
 * Mark a storefront order paid and credit DailySummary — exactly once.
 * The conditional `updateMany` is the idempotency guard: a webhook retry and a
 * vendor tap racing each other credit revenue once. Returns false if the order
 * was already paid, cancelled, or not this vendor's.
 */
export async function markOrderPaid(
  tx: Prisma.TransactionClient,
  args: {
    vendorId: string;
    transactionId: string;
    upiRef?: string | null;
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
    now?: Date;
  },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const res = await tx.transaction.updateMany({
    where: {
      id: args.transactionId,
      vendorId: args.vendorId,
      paymentStatus: { not: "PAID" },
      fulfilmentStatus: { not: "CANCELLED" },
    },
    data: {
      paymentStatus: "PAID",
      paidAt: now,
      ...(args.upiRef ? { upiRef: args.upiRef } : {}),
      ...(args.razorpayOrderId ? { razorpayOrderId: args.razorpayOrderId } : {}),
      ...(args.razorpayPaymentId ? { razorpayPaymentId: args.razorpayPaymentId } : {}),
    },
  });
  if (res.count === 0) return false;

  const t = await tx.transaction.findFirstOrThrow({
    where: { id: args.transactionId, vendorId: args.vendorId },
    select: { totalPaise: true, paymentMethod: true, orderItems: { select: { qty: true } } },
  });
  await applyToDailySummary(tx, {
    vendorId: args.vendorId,
    date: getIstTodayStart(now),
    totalPaise: t.totalPaise,
    itemsSold: t.orderItems.reduce((s, i) => s + i.qty, 0),
    paymentMethod: t.paymentMethod,
    sign: 1,
  });
  return true;
}

/**
 * Cancel a storefront order. A paid order becomes REFUNDED and its revenue is
 * reversed on the day it was credited (the vendor refunds out of band).
 */
export async function cancelOrder(
  tx: Prisma.TransactionClient,
  args: { vendorId: string; transactionId: string; now?: Date },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const t = await tx.transaction.findFirst({
    where: {
      id: args.transactionId,
      vendorId: args.vendorId,
      source: "STOREFRONT",
      fulfilmentStatus: { notIn: ["CANCELLED", "DELIVERED"] },
    },
    select: {
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
      totalPaise: true,
      orderItems: { select: { qty: true } },
    },
  });
  if (!t) return false;

  const wasPaid = t.paymentStatus === "PAID";
  const res = await tx.transaction.updateMany({
    where: { id: args.transactionId, vendorId: args.vendorId, fulfilmentStatus: { not: "CANCELLED" } },
    data: {
      fulfilmentStatus: "CANCELLED",
      cancelledAt: now,
      ...(wasPaid ? { paymentStatus: "REFUNDED" as const } : {}),
    },
  });
  if (res.count === 0) return false;

  if (wasPaid && t.paidAt) {
    await applyToDailySummary(tx, {
      vendorId: args.vendorId,
      date: getIstTodayStart(t.paidAt),
      totalPaise: t.totalPaise,
      itemsSold: t.orderItems.reduce((s, i) => s + i.qty, 0),
      paymentMethod: t.paymentMethod,
      sign: -1,
    });
  }
  return true;
}

async function applyToDailySummary(
  tx: Prisma.TransactionClient,
  a: {
    vendorId: string;
    date: Date;
    totalPaise: number;
    itemsSold: number;
    paymentMethod: PaymentMethod;
    sign: 1 | -1;
  },
): Promise<void> {
  const revenue = a.sign * a.totalPaise;
  const cash = a.paymentMethod === "CASH" ? revenue : 0;
  const upi = a.paymentMethod === "CASH" ? 0 : revenue;
  await tx.dailySummary.upsert({
    where: { vendorId_date: { vendorId: a.vendorId, date: a.date } },
    create: {
      vendorId: a.vendorId,
      date: a.date,
      totalRevenuePaise: Math.max(0, revenue),
      totalTransactions: a.sign > 0 ? 1 : 0,
      totalItemsSold: a.sign > 0 ? a.itemsSold : 0,
      cashRevenuePaise: Math.max(0, cash),
      upiRevenuePaise: Math.max(0, upi),
    },
    update: {
      totalRevenuePaise: { increment: revenue },
      totalTransactions: { increment: a.sign },
      totalItemsSold: { increment: a.sign * a.itemsSold },
      cashRevenuePaise: { increment: cash },
      upiRevenuePaise: { increment: upi },
    },
  });
}
