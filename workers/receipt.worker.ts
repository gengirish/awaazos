import { Worker } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import type { SendReceiptJobPayload } from "@/lib/queues";
import { requireEnv } from "@/lib/env";
import { sendWhatsappReceipt } from "@/lib/whatsapp";
import { formatWhatsAppReceiptMessage } from "@/lib/whatsapp-message";

const connection = new IORedis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });

export const receiptWorker = new Worker<SendReceiptJobPayload>(
  "send-receipt",
  async (job) => {
    const { transactionId, vendorId, customerPhone } = job.data;

    const tx = await prisma.transaction.findFirst({
      where: { id: transactionId, vendorId },
      include: {
        orderItems: true,
        receipt: true,
        vendor: { include: { settings: true } },
      },
    });

    if (!tx || !tx.receipt) {
      return;
    }

    if (tx.receipt.whatsappSent) {
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
  { connection },
);

receiptWorker.on("failed", (job, err) => {
  console.error(
    "[receipt.worker] job failed",
    job?.id,
    err instanceof Error ? err.message : err,
  );
});
