-- Checkout asks "when" (weekly menu slots) and a structured delivery address.
-- Every column is nullable or defaulted: existing stores, buyers and orders are untouched.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "savedLandmark" TEXT,
ADD COLUMN     "savedLocality" TEXT,
ADD COLUMN     "savedPincode" VARCHAR(6);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "deliveryLandmark" TEXT,
ADD COLUMN     "deliveryLocality" TEXT,
ADD COLUMN     "deliveryPincode" VARCHAR(6),
ADD COLUMN     "fulfilUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendor_settings" ADD COLUMN     "menuSlots" JSONB NOT NULL DEFAULT '[]';

