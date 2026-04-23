import { Worker } from "bullmq";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getBullMqConnection, type SendReceiptJobPayload } from "@/lib/queues";
import { sendWhatsappReceipt } from "@/lib/whatsapp";
import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";

export const receiptWorker = new Worker<SendReceiptJobPayload>(
  "send-receipt",
  async (job) => {
    const { transactionId, vendorId, customerPhone } = job.data;

    const tx = await prisma.transaction.findFirst({
      where: { id: transactionId, vendorId },
      include: {
        orderItems: { include: { menuItem: { select: { hsnCode: true } } } },
        receipt: true,
        vendor: { include: { settings: true } },
      },
    });

    if (!tx || !tx.receipt) {
      logger.warn(
        { worker: "receipt", jobId: job.id, transactionId, vendorId },
        "transaction or receipt not found; dropping job",
      );
      return;
    }

    if (tx.receipt.whatsappSent) {
      logger.info(
        { worker: "receipt", jobId: job.id, transactionId },
        "receipt already sent; idempotent skip",
      );
      return;
    }

    const message = formatWhatsAppReceiptMessage({
      vendorName: tx.vendor.name,
      billNumber: tx.billNumber,
      createdAt: tx.createdAt,
      items: tx.orderItems.map((o) => ({
        name: o.name,
        qty: o.qty,
        priceInPaise: o.priceInPaise,
        hsnCode: o.menuItem?.hsnCode ?? null,
      })),
      taxPaise: tx.taxPaise,
      totalPaise: tx.totalPaise,
      receiptFooter: tx.vendor.settings?.receiptFooter,
    });

    const { ok } = await sendWhatsappReceipt({
      to: customerPhone,
      message,
    });

    if (!ok) {
      // BullMQ will retry per DEFAULT_JOB_OPTS (5 attempts, exp backoff).
      // After exhaustion the job lands in the failed-jobs DLQ for 7 days.
      throw new Error("gupshup_send_failed");
    }

    await prisma.receipt.update({
      where: { id: tx.receipt.id },
      data: {
        whatsappSent: true,
        whatsappSentAt: new Date(),
        deliveredTo: customerPhone,
      },
    });
  },
  {
    connection: getBullMqConnection(),
    concurrency: 4,
    // Bull lock — if the worker crashes mid-send, the job is reclaimed after
    // 30s by another worker. Set higher than max upstream timeout (Gupshup 8s).
    lockDuration: 30_000,
  },
);

receiptWorker.on("failed", (job, err) => {
  logger.error(
    {
      worker: "receipt",
      event: "job_failed",
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      attemptsTotal: job?.opts?.attempts,
      error: err instanceof Error ? err.message : "unknown",
    },
    "receipt job failed",
  );
});

receiptWorker.on("completed", (job) => {
  logger.info(
    { worker: "receipt", event: "job_completed", jobId: job.id, attemptsMade: job.attemptsMade },
    "receipt job completed",
  );
});

receiptWorker.on("error", (err) => {
  logger.error(
    { worker: "receipt", event: "worker_error", error: err.message },
    "receipt worker error",
  );
});
