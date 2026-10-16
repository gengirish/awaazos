/**
 * The rider's "Delivered" link, /d/<riderToken> (app/d/[token]), and the
 * buyer's "I've received my order" on their order page. Server only.
 *
 * Rider link rules:
 * - Keyed on `Transaction.riderToken` alone (192-bit, minted for DELIVERY
 *   orders; lib/storefront-order-actions.ts mints it for older ones). It is a
 *   separate token from `orderToken`, so the buyer's link can never mark an
 *   order delivered and the rider's link never reaches the buyer's page.
 * - The seller sends it to their own rider in the handoff text. The page shows
 *   the rider what they need at the door (name, phone, address, items, cash to
 *   collect) only while the order is live; once delivered or cancelled it shows
 *   the outcome and no buyer details.
 * - "Delivered" runs the board's own `deliver` action through
 *   applyStorefrontOrderAction with the order's compound scope, so a cash order
 *   is marked paid (DailySummary credited once) exactly as the seller's tap does.
 * - Finishing an existing order: never blocked by a billing lock.
 * - No buyer PII in logs.
 *
 * Buyer "received": stamps `buyerReceivedAt`. On a paid order it also marks the
 * order delivered; an unpaid one (pay on delivery) waits for the seller, who
 * confirms the cash — a buyer's tap never marks money collected.
 */

import type { DropStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";

import { displayStoreName } from "@/lib/demo-store-schema";
import { prisma } from "@/lib/prisma";
import {
  applyStorefrontOrderAction,
  OrderActionError,
  storefrontOrderScope,
} from "@/lib/storefront-order-actions";

/** Same shape as orderToken / riderToken: 24 random bytes, base64url. */
export function isRiderTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}

const riderOrderSelect = {
  id: true,
  vendorId: true,
  dropId: true,
  billNumber: true,
  customerName: true,
  customerPhone: true,
  deliveryAddress: true,
  notes: true,
  paymentMethod: true,
  paymentStatus: true,
  totalPaise: true,
  advancePaidPaise: true,
  fulfilmentStatus: true,
  updatedAt: true,
  vendor: { select: { name: true, isDemo: true } },
  drop: { select: { status: true } },
  orderItems: { select: { id: true, name: true, qty: true }, orderBy: { id: "asc" } },
} satisfies Prisma.TransactionSelect;

type RiderOrderRow = Prisma.TransactionGetPayload<{ select: typeof riderOrderSelect }>;

export type RiderOrderView =
  | {
      state: "live";
      storeName: string;
      billNumber: string;
      customerName: string;
      customerPhone: string | null;
      deliveryAddress: string | null;
      notes: string | null;
      items: { id: string; name: string; qty: number }[];
      paymentMethod: PaymentMethod;
      paymentStatus: PaymentStatus;
      totalPaise: number;
      advancePaidPaise: number;
    }
  | { state: "delivered"; storeName: string; billNumber: string; at: Date }
  | { state: "cancelled"; storeName: string; billNumber: string };

function riderWhere(token: string): Prisma.TransactionWhereInput {
  return {
    riderToken: token,
    source: "STOREFRONT",
    fulfilmentType: "DELIVERY",
    vendor: { isActive: true },
  };
}

function toView(o: RiderOrderRow): RiderOrderView {
  const storeName = displayStoreName(o.vendor);
  if (o.fulfilmentStatus === "DELIVERED") {
    return { state: "delivered", storeName, billNumber: o.billNumber, at: o.updatedAt };
  }
  if (o.fulfilmentStatus === "CANCELLED") return { state: "cancelled", storeName, billNumber: o.billNumber };
  return {
    state: "live",
    storeName,
    billNumber: o.billNumber,
    customerName: o.customerName?.trim() || "Customer",
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    notes: o.notes,
    items: o.orderItems,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    totalPaise: o.totalPaise,
    advancePaidPaise: o.advancePaidPaise,
  };
}

/** What /d/<token> shows. null = unknown token (the page 404s). */
export async function loadRiderOrder(token: string): Promise<RiderOrderView | null> {
  if (!isRiderTokenShape(token)) return null;
  const o = await prisma.transaction.findFirst({ where: riderWhere(token), select: riderOrderSelect });
  return o ? toView(o) : null;
}

export type RiderDeliveredResult =
  | { ok: true; view: RiderOrderView; vendorId: string; billNumber: string; dropId: string | null }
  | { ok: false; error: "not_found" | "invalid_state" };

/** The rider's "Delivered" tap. Idempotent: a second tap on a delivered order answers invalid_state. */
export async function markDeliveredByRider(token: string, now: Date = new Date()): Promise<RiderDeliveredResult> {
  if (!isRiderTokenShape(token)) return { ok: false, error: "not_found" };
  try {
    return await prisma.$transaction(async (tx) => {
      const o = await tx.transaction.findFirst({
        where: riderWhere(token),
        select: { id: true, vendorId: true, dropId: true, billNumber: true, drop: { select: { status: true } } },
      });
      if (!o) return { ok: false, error: "not_found" } as const;
      const scope = storefrontOrderScope({ orderId: o.id, vendorId: o.vendorId, dropId: o.dropId });
      const dropStatus: DropStatus | null = o.drop?.status ?? null;
      await applyStorefrontOrderAction(tx, { scope, action: "deliver", dropStatus, now });
      const row = await tx.transaction.findFirstOrThrow({ where: scope, select: riderOrderSelect });
      return { ok: true, view: toView(row), vendorId: o.vendorId, billNumber: o.billNumber, dropId: o.dropId } as const;
    });
  } catch (err) {
    if (err instanceof OrderActionError) {
      return { ok: false, error: err.code === "Not found" ? "not_found" : "invalid_state" };
    }
    throw err;
  }
}

export type BuyerReceivedResult =
  | { ok: true; delivered: boolean; vendorId: string; billNumber: string; dropId: string | null }
  | { ok: false; error: "not_found" | "not_receivable" };

/**
 * The buyer's "I've received my order". Only a live DELIVERY order on a
 * published storefront; pickups are handed over in person. A paid order is
 * also marked delivered; an unpaid one only carries the stamp until the seller
 * confirms the cash. A second tap changes nothing (answers not_receivable).
 */
export async function recordBuyerReceived(
  args: { slug: string; orderToken: string },
  now: Date = new Date(),
): Promise<BuyerReceivedResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const o = await tx.transaction.findFirst({
        where: {
          orderToken: args.orderToken,
          source: "STOREFRONT",
          vendor: { slug: args.slug, isActive: true, settings: { is: { publishStorefront: true } } },
        },
        select: {
          id: true,
          vendorId: true,
          dropId: true,
          billNumber: true,
          paymentStatus: true,
          drop: { select: { status: true } },
        },
      });
      if (!o) return { ok: false, error: "not_found" } as const;
      const scope = storefrontOrderScope({ orderId: o.id, vendorId: o.vendorId, dropId: o.dropId });
      const stamped = await tx.transaction.updateMany({
        where: {
          ...scope,
          fulfilmentType: "DELIVERY",
          fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] },
          buyerReceivedAt: null,
        },
        data: { buyerReceivedAt: now },
      });
      if (stamped.count !== 1) return { ok: false, error: "not_receivable" } as const;
      let delivered = false;
      if (o.paymentStatus === "PAID") {
        await applyStorefrontOrderAction(tx, { scope, action: "deliver", dropStatus: o.drop?.status ?? null, now });
        delivered = true;
      }
      return { ok: true, delivered, vendorId: o.vendorId, billNumber: o.billNumber, dropId: o.dropId } as const;
    });
  } catch (err) {
    if (err instanceof OrderActionError) return { ok: false, error: "not_receivable" };
    throw err;
  }
}
