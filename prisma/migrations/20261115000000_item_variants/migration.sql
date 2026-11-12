-- Sizes / colours of a product (lib/item-variants.ts).

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "variantId" TEXT;

-- CreateTable
CREATE TABLE "item_variants" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceInPaise" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stockQty" INTEGER,
    "stockCountedAt" TIMESTAMP(3),
    "lowStockAt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_variants_menuItemId_idx" ON "item_variants"("menuItemId");

-- CreateIndex
CREATE INDEX "item_variants_vendorId_idx" ON "item_variants"("vendorId");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- AddForeignKey
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
