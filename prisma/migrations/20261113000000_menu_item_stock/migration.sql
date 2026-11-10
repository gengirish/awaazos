-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "lowStockAt" INTEGER,
ADD COLUMN     "stockCountedAt" TIMESTAMP(3),
ADD COLUMN     "stockQty" INTEGER;

-- CreateIndex
CREATE INDEX "order_items_menuItemId_idx" ON "order_items"("menuItemId");
