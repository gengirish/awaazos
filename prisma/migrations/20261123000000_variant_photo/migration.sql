-- AlterTable
-- A size / colour can point at one of its item's photos (lib/item-variants.ts rule 8).
ALTER TABLE "item_variants" ADD COLUMN     "imageUrl" TEXT;
