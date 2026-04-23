import { Worker } from "bullmq";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getBullMqConnection, type RetentionRunJobPayload } from "@/lib/queues";

const VOICE_LOG_RETENTION_DAYS = 90;
const RECEIPT_RETENTION_YEARS = 7;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

/**
 * Retention worker.
 *
 * Current policy:
 * - VoiceParseLog: delete older than 90 days
 * - Receipt: delete older than 7 years (GST/accounting horizon)
 *
 * This worker is enqueue-triggered (admin route/cron).
 */
export const retentionWorker = new Worker<RetentionRunJobPayload>(
  "retention-maintenance",
  async (job) => {
    const voiceCutoff = daysAgo(VOICE_LOG_RETENTION_DAYS);
    const receiptCutoff = yearsAgo(RECEIPT_RETENTION_YEARS);

    const [voiceDelete, receiptDelete] = await prisma.$transaction([
      prisma.voiceParseLog.deleteMany({ where: { createdAt: { lt: voiceCutoff } } }),
      prisma.receipt.deleteMany({ where: { createdAt: { lt: receiptCutoff } } }),
    ]);

    logger.info(
      {
        worker: "retention",
        event: "retention_run_complete",
        jobId: job.id,
        requestedBy: job.data.requestedBy,
        voiceDeleted: voiceDelete.count,
        receiptsDeleted: receiptDelete.count,
      },
      "retention cleanup complete",
    );
  },
  { connection: getBullMqConnection(), concurrency: 1, lockDuration: 60_000 },
);

retentionWorker.on("failed", (job, err) => {
  logger.error(
    {
      worker: "retention",
      event: "retention_failed",
      jobId: job?.id,
      error: err instanceof Error ? err.message : "unknown",
    },
    "retention job failed",
  );
});

