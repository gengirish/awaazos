import type { Metadata } from "next";
import { Ban, CheckCircle2, MapPin, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { cache } from "react";

import { RiderDeliveredButton } from "@/components/rider/RiderDeliveredButton";
import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import { riderCollectLine } from "@/lib/delivery-handoff";
import { balanceDuePaise, handoverDue } from "@/lib/drops-board";
import { formatIndianMobile } from "@/lib/phone";
import { loadRiderOrder } from "@/lib/rider-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /d/<riderToken>: the page a rider opens from the seller's WhatsApp handoff
 * (lib/rider-delivery.ts). Public and unauthenticated; the 192-bit token is
 * the whole credential. While the order is live it shows what the rider needs
 * at the door and one "Delivered" button; once delivered or cancelled it shows
 * only that, no buyer details. Unknown token or inactive seller → 404.
 */

const load = cache((token: string) => loadRiderOrder(token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const view = await load(token);
  return {
    title: view ? `Delivery ${view.billNumber} · ${view.storeName}` : "Delivery",
    robots: { index: false, follow: false },
    // The token is the whole credential: don't hand it to Maps or anything linked from here.
    referrer: "no-referrer",
  };
}

const ACTION_LINK =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-input bg-background px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary";

export default async function RiderDeliveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await load(token);
  if (!view) notFound();

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-md space-y-4 px-4 py-6">
      <header>
        <p className="text-sm font-semibold text-muted-foreground">Delivery for {view.storeName}</p>
        <h1 className="font-display text-2xl font-bold">{view.state === "live" ? view.customerName : "Delivery"}</h1>
        <p className="font-mono text-sm text-muted-foreground">{view.billNumber}</p>
      </header>

      {view.state === "delivered" ? (
        <section
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-bold">Delivered</h2>
            <p className="text-sm">{formatIstDateTime(view.at)}. Thank you!</p>
          </div>
        </section>
      ) : view.state === "cancelled" ? (
        <section
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <Ban className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-bold">This order was cancelled</h2>
            <p className="text-sm">Don&apos;t deliver it. Check with the seller.</p>
          </div>
        </section>
      ) : (
        <LiveDelivery token={token} view={view} />
      )}
    </main>
  );
}

function LiveDelivery({
  token,
  view,
}: {
  token: string;
  view: Extract<NonNullable<Awaited<ReturnType<typeof loadRiderOrder>>>, { state: "live" }>;
}) {
  const due = handoverDue(view);
  const balance = balanceDuePaise(view);
  const collect = riderCollectLine(view);
  const collectAmount = due.kind === "paid" ? 0 : balance > 0 ? balance : due.amountPaise;
  const deliveredLabel =
    due.kind === "collect_cash" ? `Delivered · ${formatINR(collectAmount)} collected` : "Delivered";
  const mapsUrl = view.deliveryAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(view.deliveryAddress)}`
    : null;

  return (
    <>
      <section
        aria-labelledby="collect-heading"
        className={
          due.kind === "paid"
            ? "rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3"
            : "rounded-2xl border border-amber-500/60 bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
        }
      >
        <h2 id="collect-heading" className="text-lg font-bold">
          {collect}
        </h2>
      </section>

      <section aria-labelledby="where-heading" className="space-y-2 rounded-2xl border bg-card px-4 py-3">
        <h2 id="where-heading" className="font-semibold">
          Where
        </h2>
        <p className="whitespace-pre-wrap">{view.deliveryAddress?.trim() || "No address given — call the customer."}</p>
        <div className="flex gap-2">
          {view.customerPhone ? (
            <a href={`tel:${view.customerPhone}`} className={ACTION_LINK}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call {formatIndianMobile(view.customerPhone)}
            </a>
          ) : null}
          {mapsUrl ? (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={ACTION_LINK}>
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Open in Maps
            </a>
          ) : null}
        </div>
        {view.notes?.trim() ? (
          <p className="text-sm">
            <span className="font-bold">Note: </span>
            <span className="whitespace-pre-wrap">{view.notes}</span>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="items-heading" className="rounded-2xl border bg-card px-4 py-3">
        <h2 id="items-heading" className="font-semibold">
          Items
        </h2>
        <ul className="mt-1 space-y-1">
          {view.items.map((it) => (
            <li key={it.id}>
              <span className="font-mono font-bold">{it.qty} ×</span> {it.name}
            </li>
          ))}
        </ul>
      </section>

      <RiderDeliveredButton token={token} label={deliveredLabel} />
    </>
  );
}
