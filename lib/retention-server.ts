import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { retentionCutoffs } from "@/lib/retention";

export type RetentionRunResult = { voiceLogsDeleted: number; receiptsDeleted: number };

/**
 * Deletes what has outlived lib/retention.ts. Idempotent: a second run the
 * same day finds nothing to delete. Run by the daily cron
 * (app/api/cron/retention) and by hand through POST /api/admin/retention/run.
 */
export async function runRetention(
  requestedBy: "cron" | "admin",
  now: Date = new Date(),
): Promise<RetentionRunResult> {
  const { voiceLogsBefore, receiptsBefore } = retentionCutoffs(now);
  const [voice, receipts] = await prisma.$transaction([
    prisma.voiceParseLog.deleteMany({ where: { createdAt: { lt: voiceLogsBefore } } }),
    prisma.receipt.deleteMany({ where: { createdAt: { lt: receiptsBefore } } }),
  ]);
  const result = { voiceLogsDeleted: voice.count, receiptsDeleted: receipts.count };
  logger.info({ event: "retention_run_complete", requestedBy, ...result }, "retention cleanup complete");
  return result;
}
