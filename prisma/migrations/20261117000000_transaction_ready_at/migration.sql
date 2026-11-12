-- "Mark ready": a pickup order packed and waiting (lib/drops-board.ts, stage "ready").
-- A stamp, not a FulfilmentStatus: the order stays CONFIRMED for stock, payment and lists.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "readyAt" TIMESTAMP(3);
