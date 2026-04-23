import { Worker } from "bullmq";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getBullMqConnection, type VoiceParseLogJobPayload } from "@/lib/queues";

export const voiceLogWorker = new Worker<VoiceParseLogJobPayload>(
  "voice-parse-log",
  async (job) => {
    const p = job.data;
    const vendor = await prisma.vendor.findUnique({
      where: { id: p.vendorId },
      select: { id: true },
    });
    if (!vendor) {
      logger.warn(
        { worker: "voiceLog", jobId: job.id, vendorId: p.vendorId },
        "vendor disappeared; dropping job",
      );
      return;
    }

    await prisma.voiceParseLog.create({
      data: {
        vendorId: p.vendorId,
        transcript: p.transcript,
        lang: p.lang,
        sttSource: p.sttSource,
        modelUsed: p.modelUsed,
        escalated: p.escalated,
        itemCount: p.itemCount,
        confidence: p.confidence,
        unmatched: p.unmatched,
        latencyMs: p.latencyMs,
      },
    });
  },
  {
    connection: getBullMqConnection(),
    concurrency: 8,
    lockDuration: 15_000,
  },
);

voiceLogWorker.on("failed", (job, err) => {
  logger.error(
    {
      worker: "voiceLog",
      event: "job_failed",
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      error: err instanceof Error ? err.message : "unknown",
    },
    "voice-parse-log job failed",
  );
});

voiceLogWorker.on("error", (err) => {
  logger.error(
    { worker: "voiceLog", event: "worker_error", error: err.message },
    "voice-parse-log worker error",
  );
});
