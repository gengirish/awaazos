-- CreateEnum
CREATE TYPE "BetComparator" AS ENUM ('GTE', 'LTE');

-- CreateEnum
CREATE TYPE "BetDecision" AS ENUM ('PENDING', 'KEEP', 'KILL');

-- CreateEnum
CREATE TYPE "TimelineMarkerKind" AS ENUM ('OUTREACH', 'EVENT', 'LAUNCH');

-- CreateTable
CREATE TABLE "admin_bets" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "hypothesis" VARCHAR(500) NOT NULL,
    "metricKey" VARCHAR(40) NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "comparator" "BetComparator" NOT NULL,
    "deadline" DATE NOT NULL,
    "decision" "BetDecision" NOT NULL DEFAULT 'PENDING',
    "notes" VARCHAR(1000),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_timeline_markers" (
    "id" TEXT NOT NULL,
    "kind" "TimelineMarkerKind" NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "note" VARCHAR(300),
    "occurredOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_timeline_markers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_bets_deadline_idx" ON "admin_bets"("deadline");

-- CreateIndex
CREATE INDEX "admin_timeline_markers_occurredOn_idx" ON "admin_timeline_markers"("occurredOn");


-- Seed bet (docs/admin-redesign/PHASE-4.md). Fixed id, so a re-run or a second
-- database never gets a duplicate; an admin can edit or delete it like any other.
-- 3000 basis points = 30%. Voice share counts only from the Phase 1 till fix
-- (PR #183, 09/11/2026), when the till started recording voice bills.
INSERT INTO "admin_bets" ("id", "title", "hypothesis", "metricKey", "targetValue", "comparator", "deadline", "decision", "notes", "createdAt", "updatedAt")
VALUES (
    'seed_bet_voice_billing',
    'Voice billing',
    'Sellers ring up at least 30% of paid bills by voice by 15/12/2026. If they don''t, demote voice to a secondary input.',
    'voice_share',
    3000,
    'GTE',
    DATE '2026-12-15',
    'PENDING',
    'Voice share is measured from 09/11/2026, when the till started recording voice bills (PR #183). Storefront orders count in the total but are never voice.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
