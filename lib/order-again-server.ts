import { soldQtyByDropItem } from "@/lib/drops";
import { everydayMenuHiddenByDrop } from "@/lib/menu-orders";
import type { OrderableNow } from "@/lib/order-again";
import { prisma } from "@/lib/prisma";
import { STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";

/**
 * What one store can take an order for right now (see lib/order-again.ts). Read
 * on page render only, the same facts the store page shows; the order routes
 * still check everything when the buyer places the order.
 */
export async function loadOrderableNow(vendorId: string, now: Date = new Date()): Promise<OrderableNow> {
  const [vendor, menuHidden] = await Promise.all([
    prisma.vendor.findFirst({
      where: { id: vendorId },
      select: {
        settings: { select: { acceptMenuOrders: true } },
        menuItems: { where: STOREFRONT_MENU_ITEM_WHERE, select: { id: true } },
        drops: {
          where: {
            status: "OPEN",
            closesAt: { gt: now },
            OR: [{ opensAt: null }, { opensAt: { lte: now } }],
          },
          orderBy: { closesAt: "asc" },
          take: 10,
          select: { id: true, items: { select: { id: true, menuItemId: true, maxQty: true } } },
        },
      },
    }),
    everydayMenuHiddenByDrop(prisma, vendorId, now),
  ]);
  if (!vendor) return { menu: new Set(), drops: [] };

  const drops = await Promise.all(
    vendor.drops.map(async (drop) => {
      const sold = drop.items.some((i) => i.maxQty !== null)
        ? await soldQtyByDropItem(prisma, drop.id, now)
        : new Map<string, number>();
      const inStock = drop.items.filter((i) => i.maxQty === null || i.maxQty - (sold.get(i.id) ?? 0) > 0);
      return { dropId: drop.id, items: new Map(inStock.map((i) => [i.menuItemId, i.id])) };
    }),
  );
  const menuOpen = (vendor.settings?.acceptMenuOrders ?? false) && !menuHidden;
  return { menu: new Set(menuOpen ? vendor.menuItems.map((i) => i.id) : []), drops };
}
