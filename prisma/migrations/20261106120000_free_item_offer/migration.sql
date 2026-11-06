-- AlterEnum
ALTER TYPE "OfferDiscountType" ADD VALUE 'FREE_ITEM';

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "freeItemId" TEXT,
ADD COLUMN     "freeItemQty" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "isGift" BOOLEAN NOT NULL DEFAULT false;
