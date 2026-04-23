import type { OrderSource, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";

import { withStatementTimeout } from "@/lib/db-timeout";

export type TransactionListFilters = {
  page: number;
  limit: number;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  source?: OrderSource;
  from?: Date;
  to?: Date;
};

const listInclude = {
  orderItems: true,
  receipt: true,
} satisfies Prisma.TransactionInclude;

export type TransactionListRow = Prisma.TransactionGetPayload<{ include: typeof listInclude }>;

export async function listVendorTransactions(
  vendorId: string,
  filters: TransactionListFilters,
): Promise<{ items: TransactionListRow[]; total: number }> {
  const skip = (filters.page - 1) * filters.limit;
  const where: Prisma.TransactionWhereInput = {
    vendorId,
    ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await withStatementTimeout(5_000, async (tx) => {
    return Promise.all([
      tx.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: filters.limit,
        include: listInclude,
      }),
      tx.transaction.count({ where }),
    ]);
  });

  return { items, total };
}
