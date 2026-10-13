import { redirect } from "next/navigation";

import { OrdersBoard } from "@/components/drops/orders/OrdersBoard";
import { InstallBanner } from "@/components/pwa/InstallPrompt";
import { loadOrdersBoard } from "@/lib/drops-board-server";
import { getOrderSignal } from "@/lib/drops-signal";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders · AwaazOS" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The one orders board: every online order, whether it came from the everyday
 * menu or from a drop. `?drop=<id>` opens it narrowed to that drop.
 */
export default async function OrdersPage(props: Props) {
  const { drop } = await props.searchParams;
  const dropId = (Array.isArray(drop) ? drop[0] : drop) || null;

  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  // Signal first, so an order landing between the reads triggers a refetch.
  const signal = await getOrderSignal(ctx.vendor.id);
  const [settings, board] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: { acceptMenuOrders: true, menuFulfilmentMode: true },
    }),
    loadOrdersBoard(ctx.vendor.id, { pinDropId: dropId }),
  ]);

  return (
    <main id="main" className="bg-background p-4 pb-16 md:p-6">
      <a href="#orders-list" className="sr-only focus:not-sr-only">
        Skip to orders
      </a>
      {/* Same column as the board. Renders nothing once installed or dismissed. */}
      <InstallBanner className="mx-auto mb-3 max-w-3xl" />
      <OrdersBoard
        vendorName={ctx.vendor.name}
        vendorSlug={ctx.vendor.slug}
        acceptMenuOrders={settings?.acceptMenuOrders ?? false}
        menuFulfilmentMode={settings?.menuFulfilmentMode ?? "PICKUP"}
        initialOrders={board.orders}
        initialDrops={board.drops}
        initialDropId={dropId}
        initialSignal={signal}
      />
    </main>
  );
}
