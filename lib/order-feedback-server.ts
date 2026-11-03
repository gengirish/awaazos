import { Prisma } from "@prisma/client";

import type { RatingSummary } from "@/lib/order-feedback";
import { prisma } from "@/lib/prisma";

export type RecordFeedbackResult =
  | { ok: true; vendorId: string; billNumber: string }
  | { ok: false; error: "not_found" | "not_ratable" | "already_rated" };

/**
 * One rating per order, once it is handed over. Public, keyed on the order
 * token plus the storefront gate. Sample orders on demo stores can't be rated.
 */
export async function recordOrderFeedback(args: {
  slug: string;
  orderToken: string;
  rating: number;
  comment: string | null;
}): Promise<RecordFeedbackResult> {
  const order = await prisma.transaction.findFirst({
    where: {
      orderToken: args.orderToken,
      source: "STOREFRONT",
      vendor: { slug: args.slug, isActive: true, settings: { is: { publishStorefront: true } } },
    },
    select: { id: true, vendorId: true, billNumber: true, fulfilmentStatus: true, isSample: true },
  });
  if (!order) return { ok: false, error: "not_found" };
  if (order.fulfilmentStatus !== "DELIVERED" || order.isSample) return { ok: false, error: "not_ratable" };
  try {
    await prisma.orderFeedback.create({
      data: { vendorId: order.vendorId, transactionId: order.id, rating: args.rating, comment: args.comment },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "already_rated" };
    }
    throw err;
  }
  return { ok: true, vendorId: order.vendorId, billNumber: order.billNumber };
}

/** Count and sum of a store's ratings, read when a page renders; nothing is stored or refreshed. */
export async function loadRatingSummary(vendorId: string): Promise<RatingSummary> {
  const r = await prisma.orderFeedback.aggregate({
    where: { vendorId },
    _count: { _all: true },
    _sum: { rating: true },
  });
  return { count: r._count._all, sum: r._sum.rating ?? 0 };
}
