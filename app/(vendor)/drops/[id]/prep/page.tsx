import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PrintButton } from "@/components/drops/orders/PrintButton";
import { formatINR } from "@/lib/currency";
import { groupByFulfilment, handoverDue, ordersToPack, type BoardOrder } from "@/lib/drops-board";
import { loadDropBoard } from "@/lib/drops-board-server";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata = { title: "Prep sheet · AwaazOS" };

type Props = { params: { id: string } };

function DueCell({ order }: { order: BoardOrder }) {
  const due = handoverDue(order);
  if (due.kind === "paid") return <span className="font-semibold">Paid</span>;
  if (due.kind === "collect_cash") {
    return (
      <span className="font-bold">
        Collect <span className="font-mono tabular-nums">{formatINR(due.amountPaise)}</span> cash
      </span>
    );
  }
  return (
    <span className="font-bold">
      UPI not paid · <span className="font-mono tabular-nums">{formatINR(due.amountPaise)}</span>
    </span>
  );
}

function HandoverTable({ title, orders, showAddress }: { title: string; orders: BoardOrder[]; showAddress: boolean }) {
  return (
    <div className="mt-4 break-inside-avoid">
      <h3 className="text-base font-semibold">
        {title} ({orders.length})
      </h3>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ol className="mt-2 divide-y rounded-md border print:rounded-none">
          {orders.map((o, i) => (
            <li key={o.id} className="break-inside-avoid p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  <span className="font-mono">{i + 1}.</span> {o.customerName?.trim() || "Customer"}
                  {o.customerPhone && (
                    <>
                      {" · "}
                      <a href={`tel:${o.customerPhone}`} className="font-mono underline-offset-4 hover:underline">
                        {o.customerPhone}
                      </a>
                    </>
                  )}
                </p>
                <DueCell order={o} />
              </div>
              {showAddress && o.deliveryAddress && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground print:text-foreground">{o.deliveryAddress}</p>
              )}
              <p className="mt-1 font-mono text-xs text-muted-foreground print:text-foreground">{o.billNumber}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default async function DropPrepPage({ params }: Props) {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  const board = await loadDropBoard(ctx.vendor.id, params.id);
  if (!board) notFound();

  const { drop, prep } = board;
  // Oldest first for packing — first come, first packed.
  const packing = ordersToPack(board.orders).slice().reverse();
  const { delivery, pickup } = groupByFulfilment(packing);
  const cook = prep.filter((p) => p.qtyOrdered > 0);
  const totalItems = cook.reduce((s, p) => s + p.qtyOrdered, 0);
  const fStart = new Date(drop.fulfilmentStartsAt);
  const fEnd = new Date(drop.fulfilmentEndsAt);
  const notFrozen = drop.status !== "FROZEN" && drop.status !== "FULFILLED";

  return (
    <main id="main" className="min-h-screen bg-background p-4 pb-16 text-foreground md:p-6 print:min-h-0 print:p-0">
      <div className="mx-auto max-w-3xl print:max-w-none">
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link
            href={`/drops/${drop.id}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            ← Back to orders
          </Link>
          <PrintButton />
        </nav>

        <header className="mb-4">
          <h1 className="font-display text-2xl font-bold">Prep sheet · {drop.title}</h1>
          <p className="text-sm text-muted-foreground print:text-foreground">
            {ctx.vendor.name} · {formatIstDate(fStart)}, {formatIstTime(fStart)} – {formatIstTime(fEnd)} ·{" "}
            {packing.length} orders · printed {formatIstDate(new Date())} {formatIstTime(new Date())}
          </p>
        </header>

        {notFrozen && (
          <div
            role="note"
            className="mb-4 flex gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 print:border-foreground print:bg-transparent print:text-foreground"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">Orders can still change</span> — freeze orders before you start cooking.{" "}
              <Link href={`/drops/${drop.id}/edit`} className="font-semibold underline print:hidden">
                Freeze on the edit page
              </Link>
            </p>
          </div>
        )}

        <section aria-labelledby="cook-h" className="mb-6 break-inside-avoid">
          <h2 id="cook-h" className="border-b pb-1 text-lg font-bold">
            1. Cook list
          </h2>
          {cook.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No orders to cook yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground print:text-foreground">
                  <th scope="col" className="py-1 font-medium">
                    Item
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Qty
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Capacity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cook.map((p) => (
                  <tr key={p.dropItemId}>
                    <td className="py-2 text-base">
                      {p.emoji && <span aria-hidden>{p.emoji} </span>}
                      {p.name}
                    </td>
                    <td className="py-2 text-right font-mono text-xl font-bold tabular-nums">{p.qtyOrdered}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground print:text-foreground">
                      {p.maxQty === null ? "—" : `${p.qtyOrdered}/${p.maxQty}`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <th scope="row" className="py-2 text-left font-semibold">
                    Total items
                  </th>
                  <td className="py-2 text-right font-mono text-xl font-bold tabular-nums">{totalItems}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section aria-labelledby="pack-h" className="mb-6 print:break-before-page">
          <h2 id="pack-h" className="border-b pb-1 text-lg font-bold">
            2. Packing list
          </h2>
          {packing.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No orders to pack.</p>
          ) : (
            <ol className="mt-2 grid gap-3 sm:grid-cols-2 print:grid-cols-2">
              {packing.map((o, i) => (
                <li key={o.id} className="break-inside-avoid rounded-md border p-3 text-sm">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      <span className="font-mono">{i + 1}.</span> {o.customerName?.trim() || "Customer"}
                    </span>
                    <span className="text-xs font-medium">{o.fulfilmentType === "PICKUP" ? "Pickup" : "Delivery"}</span>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground print:text-foreground">{o.billNumber}</p>
                  <ul className="mt-2 space-y-1">
                    {o.items.map((it) => (
                      <li key={it.id}>
                        <span aria-hidden className="mr-1 inline-block h-3.5 w-3.5 border border-foreground align-middle" />
                        <span className="font-mono font-bold tabular-nums">{it.qty} ×</span> {it.name}
                      </li>
                    ))}
                  </ul>
                  {o.notes && (
                    <p className="mt-2 flex gap-1.5 rounded border-2 border-destructive/60 p-2 font-medium print:border-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        <span className="font-bold">Note: </span>
                        <span className="whitespace-pre-wrap">{o.notes}</span>
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="handover-h" className="print:break-before-page">
          <h2 id="handover-h" className="border-b pb-1 text-lg font-bold">
            3. Delivery / pickup list
          </h2>
          {(drop.fulfilmentMode !== "PICKUP" || delivery.length > 0) && <HandoverTable title="Delivery" orders={delivery} showAddress />}
          {(drop.fulfilmentMode !== "DELIVERY" || pickup.length > 0) && (
            <>
              {drop.pickupNote && (
                <p className="mt-3 text-sm">
                  <span className="font-semibold">Pickup point: </span>
                  {drop.pickupNote}
                </p>
              )}
              <HandoverTable title="Pickup" orders={pickup} showAddress={false} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
