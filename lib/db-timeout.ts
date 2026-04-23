import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Executes Prisma queries inside a transaction with `SET LOCAL statement_timeout`.
 * Protects the app from pathological long-running SQL and keeps request latency
 * bounded under load.
 *
 * Use only for read-heavy endpoints where partial failure is acceptable.
 */
export async function withStatementTimeout<T>(
  timeoutMs: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`);
    return fn(tx);
  });
}

