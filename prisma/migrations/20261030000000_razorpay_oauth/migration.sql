-- AlterTable
ALTER TABLE "vendor_settings" ADD COLUMN     "razorpayAccessTokenEnc" TEXT,
ADD COLUMN     "razorpayAccountId" TEXT,
ADD COLUMN     "razorpayPublicToken" TEXT,
ADD COLUMN     "razorpayRefreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "razorpayRefreshTokenEnc" TEXT,
ADD COLUMN     "razorpayTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "vendor_settings_razorpayAccountId_idx" ON "vendor_settings"("razorpayAccountId");
