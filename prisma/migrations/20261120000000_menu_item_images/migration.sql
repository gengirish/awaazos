-- CreateTable
CREATE TABLE "menu_item_images" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_item_images_vendorId_menuItemId_idx" ON "menu_item_images"("vendorId", "menuItemId");

-- CreateIndex
CREATE INDEX "menu_item_images_menuItemId_sortOrder_idx" ON "menu_item_images"("menuItemId", "sortOrder");

-- AddForeignKey
ALTER TABLE "menu_item_images" ADD CONSTRAINT "menu_item_images_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_images" ADD CONSTRAINT "menu_item_images_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
