-- CreateEnum
CREATE TYPE "DemoArchiveReason" AS ENUM ('manual', 'stale', 'duplicate', 'test');

-- AlterTable
ALTER TABLE "demo_audit_logs" ADD COLUMN "payload" JSONB;

-- CreateTable
CREATE TABLE "demo_pipeline" (
    "vendorId" TEXT NOT NULL,
    "contactName" VARCHAR(40),
    "contactEmail" TEXT,
    "inviteSentAt" TIMESTAMP(3),
    "lastNudgeAt" TIMESTAMP(3),
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "snoozedUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedReason" "DemoArchiveReason",
    "restoredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_pipeline_pkey" PRIMARY KEY ("vendorId")
);

-- CreateIndex
CREATE INDEX "demo_pipeline_deletedAt_idx" ON "demo_pipeline"("deletedAt");

-- CreateIndex
CREATE INDEX "demo_audit_logs_vendorId_createdAt_idx" ON "demo_audit_logs"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "demo_pipeline" ADD CONSTRAINT "demo_pipeline_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
