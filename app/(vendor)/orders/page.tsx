import { redirect } from "next/navigation";

import { OrdersBoard } from "@/components/drops/orders/OrdersBoard";
import { loadMenuOrdersBoard } from "@/lib/drops-board-server";
import { getDropOrderSignal } from "@/lib/drops-signal";
import { MENU_ORDERS_SIGNAL_ID } from "@/lib/menu-orders";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Online orders · AwaazOS" };

/** "Order from menu" board: storefront orders with no drop. */
export default async function OnlineOrdersPage() {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  // Signal first, so an order landing between the reads triggers a refetch.
  const signal = await getDropOrderSignal(ctx.vendor.id, MENU_ORDERS_SIGNAL_ID);
  const [settings, board] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { acceptMenuOrders: true, menuFulfilmentMode: true },
    }),
    loadMenuOrdersBoard(ctx.vendor.id),
  ]);

  return (
    <main id="main" className="bg-background p-4 pb-16 md:p-6">
      <a href="#orders-list" className="sr-only focus:not-sr-only">
        Skip to orders
      </a>
      <OrdersBoard
        vendorName={ctx.vendor.name}
        vendorSlug={ctx.vendor.slug}
        source={{
          kind: "menu",
          acceptMenuOrders: settings?.acceptMenuOrders ?? false,
          fulfilmentMode: settings?.menuFulfilmentMode ?? "PICKUP",
        }}
        initialOrders={board.orders}
        initialSignal={signal}
      />
    </main>
  );
}
