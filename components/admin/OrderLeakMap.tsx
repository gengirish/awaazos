import Link from "next/link";
import { Filter } from "lucide-react";

import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { ADMIN_METRICS_CONFIG } from "@/lib/admin-metrics-config";
import { formatINR } from "@/lib/currency";
import { formatIstDate, formatIstDateTime } from "@/lib/datetime";
import {
  FUNNEL_SOURCES,
  SOURCE_LABEL,
  STALLED_FILTERS,
  STALLED_LABEL,
  type StageCounts,
  type StalledFilter,
  type StalledOrder,
  stepRate,
} from "@/lib/order-funnel";
import type { LoadedOrderFunnel } from "@/lib/order-funnel-server";
import { cn } from "@/lib/utils";

/** Column headings on a phone, so all six columns fit at 375 px; screen readers get the full name. */
const SOURCE_SHORT: Record<(typeof FUNNEL_SOURCES)[number], string> = {
  instagram: "Insta",
  whatsapp: "WA",
  direct: "Direct",
  other: "Other",
};

/** Most unpaid orders listed at once; the count above says how many there are. */
const STALLED_SHOWN = 50;

const STATUS_LABEL: Record<StalledOrder["status"], string | null> = {
  open: null,
  cancelled: "Cancelled",
  delivered: "Handed over, not marked paid",
};

function stageLabel(o: StalledOrder): string {
  if (o.stage === "not_started") return "Didn't start paying";
  return o.payOnDelivery ? "Pay on delivery, not collected" : "Started paying, not paid";
}

type Props = {
  funnel: LoadedOrderFunnel;
  /** Storefront orders the Instagram card counted over the same window, to reconcile with. */
  expectedOrders: number;
  filter: StalledFilter | null;
  /** Prefilled Remind text per order id; null when the viewer may not see contacts. */
  messages: Record<string, string> | null;
  /** /admin/metrics with this filter, keeping the page's other query params. */
  hrefFor: (filter: StalledFilter | null) => string;
};

function Cell({ count, of }: { count: number; of: number | null }) {
  const rate = of === null ? null : stepRate(count, of);
  return (
    <td className="px-1 py-2 text-right align-top tabular-nums sm:px-2">
      <span className="font-semibold text-foreground">{count.toLocaleString("en-IN")}</span>
      {rate ? <span className="block text-xs text-muted-foreground">{rate}</span> : null}
    </td>
  );
}

function CountRow({ label, counts, of }: { label: string; counts: StageCounts; of: StageCounts | null }) {
  return (
    <tr className="border-t">
      <th scope="row" className="py-2 pr-1 text-left align-top font-medium text-foreground sm:pr-2">
        {label}
      </th>
      <Cell count={counts.total} of={of?.total ?? null} />
      {FUNNEL_SOURCES.map((s) => (
        <Cell key={s} count={counts.bySource[s]} of={of?.bySource[s] ?? null} />
      ))}
    </tr>
  );
}

function TextRow({ label, text }: { label: string; text: string }) {
  return (
    <tr className="border-t">
      <th scope="row" className="py-2 pr-1 text-left align-top font-medium text-foreground sm:pr-2">
        {label}
      </th>
      <td colSpan={FUNNEL_SOURCES.length + 1} className="px-1 py-2 text-muted-foreground sm:px-2">
        {text}
      </td>
    </tr>
  );
}

/**
 * Storefront orders of the last 7 complete IST days, stage by stage and source by
 * source (lib/order-funnel.ts), then the unpaid ones to chase. Stages we can't
 * count say so; no number on this card is estimated.
 */
export function OrderLeakMap({ funnel, expectedOrders, filter, messages, hrefFor }: Props) {
  const { views, placed, started, paid, biggestLeak } = funnel;
  const windowLabel = `${formatIstDate(funnel.windowStart)} to ${formatIstDate(
    new Date(funnel.windowEnd.getTime() - 86_400_000),
  )}`;
  const viewsSince = views.status === "full" || views.status === "partial" ? views.since : null;
  const instagramSince = ADMIN_METRICS_CONFIG.tracking.orderChannelSince;

  const stalledCounts = { not_started: 0, started: 0 };
  for (const o of funnel.stalled) stalledCounts[o.stage] += 1;
  const shown = filter ? funnel.stalled.filter((o) => o.stage === filter) : funnel.stalled;
  const chips: { key: StalledFilter | null; label: string; count: number }[] = [
    { key: null, label: "All unpaid", count: funnel.stalled.length },
    ...STALLED_FILTERS.map((f) => ({ key: f, label: STALLED_LABEL[f], count: stalledCounts[f] })),
  ];

  return (
    <section aria-labelledby="leak-heading" className="space-y-3">
      <div>
        <h2 id="leak-heading" className="font-display text-xl font-semibold text-foreground">
          Order leak map
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Storefront orders placed {windowLabel}, and how far each got. Columns are where the buyer came from; the
          small figure is the share of the stage above.
        </p>
      </div>

      {placed.total !== expectedOrders ? (
        <Notice tone="warning">
          The leak map counts {placed.total} orders but the Instagram card counts {expectedOrders} for the same days.
          One of the two queries is wrong; don&apos;t trust either until it is fixed.
        </Notice>
      ) : null}

      <div className="rounded-lg border bg-card p-3 sm:p-4">
        {biggestLeak ? (
          <p className="mb-3 text-sm text-foreground">
            <span className="font-semibold">Biggest leak: {biggestLeak.from} → {biggestLeak.to}.</span>{" "}
            {biggestLeak.lost.toLocaleString("en-IN")} of {biggestLeak.of.toLocaleString("en-IN")} went no further.
          </p>
        ) : placed.total > 0 ? (
          <p className="mb-3 text-sm text-foreground">Every order placed in these days was paid.</p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Storefront funnel by source, {windowLabel}. Each figure under a count is its share of the stage above.
            </caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 pr-2 text-left font-medium">
                  Stage
                </th>
                <th scope="col" className="px-1 pb-2 text-right font-medium sm:px-2">
                  All
                </th>
                {FUNNEL_SOURCES.map((s) => (
                  <th key={s} scope="col" className="px-1 pb-2 text-right font-medium sm:px-2">
                    <span aria-hidden className="sm:hidden">
                      {SOURCE_SHORT[s]}
                    </span>
                    <span className="sr-only sm:not-sr-only">{SOURCE_LABEL[s]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {views.status === "full" || views.status === "partial" ? (
                <CountRow label="Store views" counts={views.counts} of={null} />
              ) : (
                <TextRow
                  label="Store views"
                  text={views.status === "unavailable" ? "Not tracked: the view counter can't be read" : "Not tracked yet"}
                />
              )}
              <TextRow label="Cart" text="Not tracked" />
              <CountRow label="Order placed" counts={placed} of={views.status === "full" ? views.counts : null} />
              <CountRow label="Payment started" counts={started} of={placed} />
              <CountRow label="Paid" counts={paid} of={started} />
            </tbody>
          </table>
        </div>

        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            Order placed matches the {expectedOrders.toLocaleString("en-IN")} storefront orders the Instagram card
            counts. Paid is as of now, so an order from these days paid today still counts.
          </li>
          <li>
            Store views are full loads of a store page by a buyer&apos;s browser: not link previews, bots, the
            store&apos;s own staff or demo stores. A refresh counts again.
            {views.status === "partial"
              ? ` Counted since ${formatIstDate(views.since)}, part of these days, so there is no view-to-order share yet.`
              : views.status === "full"
                ? ` Counted since ${formatIstDate(views.since)}.`
                : ""}
          </li>
          <li>
            Payment started: Razorpay was opened, the buyer tapped &quot;Payment done&quot;, or chose pay on delivery.
            A buyer who opened a UPI app and never said so counts as not started.
          </li>
          <li>
            Instagram is counted from {formatIstDate(instagramSince)}; WhatsApp from{" "}
            {viewsSince ? formatIstDate(viewsSince) : "this release"}, for links shared with WhatsApp buttons. Before
            those dates, and for untagged links, orders count as Direct. Other is Facebook&apos;s and
            Messenger&apos;s in-app browsers.
          </li>
        </ul>
      </div>

      <h3 className="pt-2 font-semibold text-foreground">Unpaid orders ({funnel.stalled.length.toLocaleString("en-IN")})</h3>
      <nav aria-label="Filter unpaid orders" className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = c.key === filter;
          return (
            <Link
              key={c.label}
              href={hrefFor(c.key)}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground",
              )}
            >
              {c.label} <span className="ml-1 tabular-nums">{c.count}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={funnel.stalled.length === 0 ? "No unpaid orders in these days" : `No orders here: ${STALLED_LABEL[filter!].toLowerCase()}`}
        />
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.slice(0, STALLED_SHOWN).map((o) => {
              const store = funnel.stores[o.vendorId];
              const status = STATUS_LABEL[o.status];
              const message = messages && o.status === "open" ? messages[o.id] : undefined;
              return (
                <li key={o.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-foreground">{store?.name ?? "Unknown store"}</p>
                      <p className="text-xs text-muted-foreground">{o.billNumber}</p>
                    </div>
                    <p className="font-semibold tabular-nums text-foreground">{formatINR(o.totalPaise)}</p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Placed</dt>
                      <dd className="tabular-nums">{formatIstDateTime(o.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Source</dt>
                      <dd>{SOURCE_LABEL[o.source]}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Got to</dt>
                      <dd>
                        {stageLabel(o)}
                        {status ? (
                          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{status}</span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                  {message !== undefined && store ? (
                    <details className="mt-3">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                        Remind the seller on WhatsApp
                      </summary>
                      <div className="pt-2">
                        <OutreachWhatsApp phone={store.phone} message={message} label="Open WhatsApp" />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {shown.length > STALLED_SHOWN ? (
            <p className="text-sm text-muted-foreground">
              Showing the newest {STALLED_SHOWN} of {shown.length.toLocaleString("en-IN")}.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
