-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('EARNED', 'REDEEMED');

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "referredByVendorId" TEXT;

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referrerVendorId" TEXT NOT NULL,
    "referredVendorId" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'EARNED',
    "redeemedVia" TEXT,
    "sourceEventId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_referredByVendorId_idx" ON "vendors"("referredByVendorId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_referredVendorId_key" ON "referral_rewards"("referredVendorId");

-- CreateIndex
CREATE INDEX "referral_rewards_referrerVendorId_status_idx" ON "referral_rewards"("referrerVendorId", "status");

-- CreateIndex
CREATE INDEX "referral_rewards_earnedAt_idx" ON "referral_rewards"("earnedAt");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_referredByVendorId_fkey" FOREIGN KEY ("referredByVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrerVendorId_fkey" FOREIGN KEY ("referrerVendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referredVendorId_fkey" FOREIGN KEY ("referredVendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
