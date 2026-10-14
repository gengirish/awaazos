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
import { BOARD_MAX_ORDERS, menuBoardWindowStart } from "@/lib/menu-orders-board";
import { prisma } from "@/lib/prisma";

export const boardOrderSelect = {
  id: true,
  dropId: true,
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
  advancePaidPaise: true,
  fulfilAt: true,
  isSample: true,
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
    dropId: row.dropId,
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
    advancePaidPaise: row.advancePaidPaise,
    fulfilAt: row.fulfilAt?.toISOString() ?? null,
    isSample: row.isSample,
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

const boardDropInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: { menuItem: { select: { name: true, emoji: true } } },
  },
} satisfies Prisma.DropInclude;

type BoardDropRow = Prisma.DropGetPayload<{ include: typeof boardDropInclude }>;

function toBoardDrop(drop: BoardDropRow, now: Date): BoardDrop {
  return {
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
    items: drop.items.map((i) => ({
      id: i.id,
      name: i.menuItem.name,
      emoji: i.menuItem.emoji,
      maxQty: i.maxQty,
    })),
  };
}

/** One drop with all its orders, for the prep sheet. null = not this vendor's drop (caller 404s). */
export async function loadDropBoard(
  vendorId: string,
  dropId: string,
  now: Date = new Date(),
): Promise<DropBoard | null> {
  const row = await prisma.drop.findFirst({ where: { id: dropId, vendorId }, include: boardDropInclude });
  if (!row) return null;

  const rows = await prisma.transaction.findMany({
    where: { vendorId, dropId: row.id, source: "STOREFRONT" },
    orderBy: { createdAt: "desc" },
    select: boardOrderSelect,
  });

  const orders = rows.map((r) => toBoardOrder(r, now));
  const drop = toBoardDrop(row, now);

  return {
    drop,
    orders,
    summary: summarizeOrders(orders),
    prep: prepFromOrders(drop.items, orders),
  };
}

// ─── The orders board: menu orders and drop orders together ─────────

export type OrdersBoardData = {
  orders: BoardOrder[];
  /** Drops the board can be narrowed to, soonest handover first. */
  drops: BoardDrop[];
  summary: BoardSummary;
};

/**
 * Drops that are still in play: published, with a pickup / delivery window
 * that has not ended more than MENU_BOARD_WINDOW_DAYS IST days ago. Every
 * order of such a drop is on the board, however early it was placed, so the
 * drop's totals and "to cook" figures are whole.
 */
function currentDropWhere(now: Date): Prisma.DropWhereInput {
  return { status: { not: "DRAFT" }, fulfilmentEndsAt: { gte: menuBoardWindowStart(now) } };
}

/**
 * Prisma filter for the orders board: this vendor's storefront orders (menu and
 * drop alike) that are
 *   - placed in the last MENU_BOARD_WINDOW_DAYS IST days, or
 *   - older but still open (PLACED / CONFIRMED) and holding stock — i.e. they
 *     still need the vendor, or
 *   - part of a current drop (see `currentDropWhere`), or of `pinDropId`.
 * Old expired unpaid UPI orders fall off rather than pile up.
 */
export function ordersBoardWhere(
  vendorId: string,
  now: Date = new Date(),
  pinDropId?: string | null,
): Prisma.TransactionWhereInput {
  return {
    vendorId,
    source: "STOREFRONT",
    archivedAt: null, // a claimed demo store's hidden sample orders
    OR: [
      { createdAt: { gte: menuBoardWindowStart(now) } },
      { AND: [{ fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } }, stockHoldingOrderWhere(now)] },
      { drop: currentDropWhere(now) },
      ...(pinDropId ? [{ dropId: pinDropId }] : []),
    ],
  };
}

/**
 * Everything `/orders` shows. `pinDropId` (from `?drop=`) keeps one older drop
 * on the board with all its orders, so a past drop can still be opened from the
 * Drops list; an id that is not this vendor's simply matches nothing.
 */
export async function loadOrdersBoard(
  vendorId: string,
  opts: { pinDropId?: string | null; now?: Date } = {},
): Promise<OrdersBoardData> {
  const now = opts.now ?? new Date();
  const pinDropId = opts.pinDropId || null;

  const rows = await prisma.transaction.findMany({
    where: ordersBoardWhere(vendorId, now, pinDropId),
    orderBy: { createdAt: "desc" },
    take: BOARD_MAX_ORDERS,
    select: boardOrderSelect,
  });
  const orders = rows.map((r) => toBoardOrder(r, now));

  const orderDropIds = Array.from(new Set(orders.flatMap((o) => (o.dropId ? [o.dropId] : []))));
  const dropRows = await prisma.drop.findMany({
    where: {
      vendorId,
      OR: [
        currentDropWhere(now),
        { id: { in: orderDropIds } },
        ...(pinDropId ? [{ id: pinDropId }] : []),
      ],
    },
    orderBy: [{ fulfilmentStartsAt: "asc" }, { createdAt: "asc" }],
    include: boardDropInclude,
  });

  return { orders, drops: dropRows.map((d) => toBoardDrop(d, now)), summary: summarizeOrders(orders) };
}
