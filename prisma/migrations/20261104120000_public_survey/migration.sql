-- CreateTable
CREATE TABLE "public_survey_responses" (
    "id" TEXT NOT NULL,
    "pains" TEXT[],
    "topPain" TEXT NOT NULL,
    "weeklyOrders" TEXT NOT NULL,
    "willingToPay" TEXT NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_survey_responses_createdAt_idx" ON "public_survey_responses"("createdAt");
