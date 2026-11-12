-- Cost price per product and size, and its snapshot on each bill line (lib/item-cost.ts).

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN "costInPaise" INTEGER;

-- AlterTable
ALTER TABLE "item_variants" ADD COLUMN "costInPaise" INTEGER;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "costInPaise" INTEGER;
