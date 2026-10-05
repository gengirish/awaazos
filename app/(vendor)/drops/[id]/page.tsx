import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrdersBoard } from "@/components/drops/orders/OrdersBoard";
import { loadDropBoard } from "@/lib/drops-board-server";
import { getDropOrderSignal } from "@/lib/drops-signal";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

export const metadata = { title: "Drop orders · AwaazOS" };

export default async function DropOrdersPage({ params }: Props) {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  // Signal first, so an order landing between the reads triggers a refetch.
  const signal = await getDropOrderSignal(ctx.vendor.id, params.id);
  const board = await loadDropBoard(ctx.vendor.id, params.id);
  if (!board) notFound();

  return (
    <main id="main" className="min-h-screen bg-background p-4 pb-16 md:p-6">
      <a href="#orders-list" className="sr-only focus:not-sr-only">
        Skip to orders
      </a>
      <nav aria-label="Breadcrumb" className="mx-auto mb-3 max-w-3xl text-sm">
        <Link href="/drops" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
          ← All drops
        </Link>
      </nav>
      <OrdersBoard
        vendorName={ctx.vendor.name}
        vendorSlug={ctx.vendor.slug}
        source={{ kind: "drop", initialDrop: board.drop }}
        initialOrders={board.orders}
        initialSignal={signal}
      />
    </main>
  );
}
