/**
 * Server half of the vendor orders board: tenant-scoped Prisma loader and the
 * row → BoardOrder serialiser shared by the orders API, the board page and the
 * prep sheet. Pure bucketing/aggregation lives in lib/drops-board.ts.
 */

import type { DropStatus, FulfilmentMode, Prisma } from "@prisma/client";

import {
  boardBucket,
  prepFromOrders,
  summarizeOrders,
  type BoardOrder,
  type BoardSummary,
  type PrepRow,
} from "@/lib/drops-board";
import {
  effectiveDropStatus,
  orderDisplayState,
  orderHoldsStock,
  stockHoldingOrderWhere,
  type EffectiveDropStatus,
} from "@/lib/drops";
import { MENU_BOARD_MAX_ORDERS, menuBoardWindowStart } from "@/lib/menu-orders-board";
import { prisma } from "@/lib/prisma";

export const boardOrderSelect = {
  id: true,
  billNumber: true,
  createdAt: true,
  customerName: true,
  customerPhone: true,
  fulfilmentType: true,
  fulfilmentStatus: true,
  deliveryAddress: true,
  notes: true,
  paymentMethod: true,
  paymentStatus: true,
  upiRef: true,
  paymentClaimedAt: true,
  subtotalPaise: true,
  discountPaise: true,
  offerName: true,
  deliveryFeePaise: true,
  totalPaise: true,
  orderItems: {
    select: { id: true, dropItemId: true, name: true, qty: true, priceInPaise: true, totalPaise: true },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.TransactionSelect;

export type BoardOrderRow = Prisma.TransactionGetPayload<{ select: typeof boardOrderSelect }>;

export function toBoardOrder(row: BoardOrderRow, now: Date = new Date()): BoardOrder {
  const displayState = orderDisplayState(row, now);
  return {
    id: row.id,
    billNumber: row.billNumber,
    createdAt: row.createdAt.toISOString(),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    fulfilmentType: row.fulfilmentType,
    fulfilmentStatus: row.fulfilmentStatus,
    deliveryAddress: row.deliveryAddress,
    notes: row.notes,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    upiRef: row.upiRef,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    offerName: row.offerName,
    deliveryFeePaise: row.deliveryFeePaise,
    totalPaise: row.totalPaise,
    displayState,
    holdsStock: orderHoldsStock(row, now),
    bucket: boardBucket({ displayState, fulfilmentStatus: row.fulfilmentStatus }),
    items: row.orderItems,
  };
}

/** JSON-safe drop header for the board (dates as ISO strings). */
export type BoardDrop = {
  id: string;
  title: string;
  status: DropStatus;
  effectiveStatus: EffectiveDropStatus;
  date: string;
  opensAt: string | null;
  closesAt: string;
  fulfilmentMode: FulfilmentMode;
  fulfilmentStartsAt: string;
  fulfilmentEndsAt: string;
  pickupNote: string | null;
  deliveryFeePaise: number;
  items: { id: string; name: string; emoji: string | null; maxQty: number | null }[];
};

export type DropBoard = {
  drop: BoardDrop;
  orders: BoardOrder[];
  summary: BoardSummary;
  prep: PrepRow[];
};

/** Everything the board / prep sheet need. null = not this vendor's drop (caller 404s). */
export async function loadDropBoard(
  vendorId: string,
  dropId: string,
  now: Date = new Date(),
): Promise<DropBoard | null> {
  const drop = await prisma.drop.findFirst({
    where: { id: dropId, vendorId },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { menuItem: { select: { name: true, emoji: true } } },
      },
    },
  });
  if (!drop) return null;

  const rows = await prisma.transaction.findMany({
    where: { vendorId, dropId: drop.id, source: "STOREFRONT" },
    orderBy: { createdAt: "desc" },
    select: boardOrderSelect,
  });

  const orders = rows.map((r) => toBoardOrder(r, now));
  const items = drop.items.map((i) => ({
    id: i.id,
    name: i.menuItem.name,
    emoji: i.menuItem.emoji,
    maxQty: i.maxQty,
  }));

  return {
    drop: {
      id: drop.id,
      title: drop.title,
      status: drop.status,
      effectiveStatus: effectiveDropStatus(drop, now),
      date: drop.date.toISOString(),
      opensAt: drop.opensAt?.toISOString() ?? null,
      closesAt: drop.closesAt.toISOString(),
      fulfilmentMode: drop.fulfilmentMode,
      fulfilmentStartsAt: drop.fulfilmentStartsAt.toISOString(),
      fulfilmentEndsAt: drop.fulfilmentEndsAt.toISOString(),
      pickupNote: drop.pickupNote,
      deliveryFeePaise: drop.deliveryFeePaise,
      items,
    },
    orders,
    summary: summarizeOrders(orders),
    prep: prepFromOrders(items, orders),
  };
}

// ─── "Order from menu" board ────────────────────────────────────────

export type MenuOrdersBoard = {
  orders: BoardOrder[];
  summary: BoardSummary;
};

/**
 * Prisma filter for the menu-orders board: this vendor's storefront orders
 * with no drop, placed in the last MENU_BOARD_WINDOW_DAYS IST days, plus any
 * older one still open (PLACED / CONFIRMED) that holds stock — i.e. still
 * needs the vendor. Old expired unpaid UPI orders fall off rather than pile up.
 */
export function menuOrdersBoardWhere(vendorId: string, now: Date = new Date()): Prisma.TransactionWhereInput {
  return {
    vendorId,
    source: "STOREFRONT",
    dropId: null,
    OR: [
      { createdAt: { gte: menuBoardWindowStart(now) } },
      { AND: [{ fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } }, stockHoldingOrderWhere(now)] },
    ],
  };
}

export async function loadMenuOrdersBoard(vendorId: string, now: Date = new Date()): Promise<MenuOrdersBoard> {
  const rows = await prisma.transaction.findMany({
    where: menuOrdersBoardWhere(vendorId, now),
    orderBy: { createdAt: "desc" },
    take: MENU_BOARD_MAX_ORDERS,
    select: boardOrderSelect,
  });
  const orders = rows.map((r) => toBoardOrder(r, now));
  return { orders, summary: summarizeOrders(orders) };
}
