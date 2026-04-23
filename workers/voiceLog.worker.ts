import { Worker } from "bullmq";
import IORedis from "ioredis";

import type { VoiceParseLogJobPayload } from "@/lib/queues";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";

const connection = new IORedis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });

export const voiceLogWorker = new Worker<VoiceParseLogJobPayload>(
  "voice-parse-log",
  async (job) => {
    const p = job.data;
    const vendor = await prisma.vendor.findUnique({
      where: { id: p.vendorId },
      select: { id: true },
    });
    if (!vendor) {
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
  { connection },
);

voiceLogWorker.on("failed", (job, err) => {
  console.error(
    "[voiceLog.worker] job failed",
    job?.id,
    err instanceof Error ? err.message : err,
  );
});
