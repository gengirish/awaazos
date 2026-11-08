-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "customPricePaise" INTEGER;

-- CreateTable
CREATE TABLE "owner_survey_responses" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "pains" TEXT[],
    "topPain" TEXT NOT NULL,
    "weeklyOrders" TEXT NOT NULL,
    "willingToPay" TEXT NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_razorpay_plans" (
    "id" TEXT NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "interval" TEXT NOT NULL,
    "razorpayPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_razorpay_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_survey_responses_vendorId_key" ON "owner_survey_responses"("vendorId");

-- CreateIndex
CREATE INDEX "owner_survey_responses_updatedAt_idx" ON "owner_survey_responses"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_razorpay_plans_razorpayPlanId_key" ON "custom_razorpay_plans"("razorpayPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_razorpay_plans_basePaise_interval_key" ON "custom_razorpay_plans"("basePaise", "interval");

-- AddForeignKey
ALTER TABLE "owner_survey_responses" ADD CONSTRAINT "owner_survey_responses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
