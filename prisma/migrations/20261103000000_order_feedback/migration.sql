-- CreateTable
CREATE TABLE "order_feedback" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_feedback_transactionId_key" ON "order_feedback"("transactionId");

-- CreateIndex
CREATE INDEX "order_feedback_vendorId_createdAt_idx" ON "order_feedback"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "order_feedback" ADD CONSTRAINT "order_feedback_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_feedback" ADD CONSTRAINT "order_feedback_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
