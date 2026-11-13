-- CreateTable
CREATE TABLE "stock_purchases" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantLabel" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCostInPaise" INTEGER,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_purchases_vendorId_purchasedAt_idx" ON "stock_purchases"("vendorId", "purchasedAt");

-- CreateIndex
CREATE INDEX "stock_purchases_menuItemId_purchasedAt_idx" ON "stock_purchases"("menuItemId", "purchasedAt");

-- CreateIndex
CREATE INDEX "stock_purchases_variantId_idx" ON "stock_purchases"("variantId");

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

