-- CreateEnum
CREATE TYPE "FoodType" AS ENUM ('VEG', 'NON_VEG', 'EGG');

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "details" VARCHAR(1000),
ADD COLUMN     "foodType" "FoodType",
ADD COLUMN     "highlights" JSONB;
