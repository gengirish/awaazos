-- CreateEnum
CREATE TYPE "ReferralCreditStatus" AS ENUM ('PENDING', 'REFUNDED');

-- AlterTable
ALTER TABLE "referral_rewards" ADD COLUMN "monthsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "referral_credits" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "chargePaise" INTEGER NOT NULL,
    "refundPaise" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "status" "ReferralCreditStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayRefundId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "referral_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_credits_paymentId_key" ON "referral_credits"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_credits_sourceEventId_key" ON "referral_credits"("sourceEventId");

-- CreateIndex
CREATE INDEX "referral_credits_status_createdAt_idx" ON "referral_credits"("status", "createdAt");

-- CreateIndex
CREATE INDEX "referral_credits_vendorId_createdAt_idx" ON "referral_credits"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
