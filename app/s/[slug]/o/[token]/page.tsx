import type { Metadata } from "next";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  MapPin,
  MessageCircle,
  QrCode,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { OrderLinkActions } from "@/components/storefront/OrderLinkActions";
import { OrderRefresh } from "@/components/storefront/OrderRefresh";
import { OtherCartsNotice } from "@/components/storefront/OtherCartsNotice";
import { PaidClaimForm } from "@/components/storefront/PaidClaimForm";
import { RazorpayPayButton } from "@/components/storefront/RazorpayPayButton";
import { UpiPayOptions } from "@/components/storefront/UpiPayOptions";
import { UpiQrImage } from "@/components/storefront/UpiQrImage";
import { formatINR, paiseToRupees } from "@/lib/currency";
import { orderDisplayState, PENDING_HOLD_MINUTES } from "@/lib/drops";
import { formatFulfilmentWindow, formatIstDate, formatIstTime } from "@/lib/drops-time";
import {
  buyerWhatsappNumber,
  formatWhatsAppOrderMessage,
  handedOverLabel,
  holdMinutesLeft,
  orderStatusLabel,
  payOnDeliveryLabel,
  whatsappChatLink,
  type StatusTone,
} from "@/lib/storefront-order";
import { discountLabel } from "@/lib/offers";
import { prisma } from "@/lib/prisma";
import { appBaseUrl, isOnlinePaymentEnabled } from "@/lib/storefront-razorpay";
import { qrSvgDataUrl } from "@/lib/qr";
import { buildUpiDeepLink } from "@/lib/upi";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Buyer's order page — reached only via the 192-bit `orderToken` handed back at
 * checkout. Same gate as the storefront (active vendor + publishStorefront), so
 * a vendor who unpublishes takes these pages down too; misses are 404.
 *
 * The buyer typed the address and notes, so they are shown back in full here.
 * Vendor contact PII (`Vendor.phone`, `Vendor.email`) is never selected; the
 * only contact route is the vendor's opted-in WhatsApp business number. The UTR
 * is read only as a boolean ("payment submitted") and never rendered.
 *
 * UPI pay: `UpiPayOptions` (client) leads with the generic `upi://` button on
 * Android and with per-app buttons (GPay / PhonePe / Paytm) on iPhone, where
 * `upi://` has no app chooser; plus copy-UPI-ID / copy-amount. The QR, for
 * scanning from a second phone, sits in a collapsed <details> under them. Only
 * the vendor VPA and total reach it. Step 2, "Tell the store you've paid", is
 * the outlined `PaidClaimForm` — it never marks the order paid.
 *
 * Nothing here polls. `OrderRefresh` re-reads the order when the buyer comes
 * back to the tab and from its "Check for update" button; the hold deadline is
 * printed as a clock time, which stays true however long the page is open.
 * `OrderLinkActions` remembers the order on the device (token, bill number and
 * time only) and shares the order link.
 *
 * When the store has connected its own Razorpay account (PRO plan), "Pay
 * online" is offered above the UPI intent/QR. The buyer's own name and phone
 * are handed to that button only to prefill Razorpay Checkout. Razorpay
 * credentials are selected for presence checks only — never rendered or passed
 * to a client component.
 *
 * Menu orders ("Order from menu", lib/menu-orders.ts) have `drop = null`: no
 * drop title or fulfilment window; a pickup shows the vendor's
 * `menuPickupNote` instead of the drop's.
 *
 * WhatsApp: the store's opted-in number gets a wa.me link pre-filled with
 * the whole order (`formatWhatsAppOrderMessage`). `?wa=1` — set when the buyer
 * ticked "Also send my order to the store on WhatsApp" at checkout — puts that
 * link at the top as the next step. The buyer sends it from their own WhatsApp;
 * nothing is sent from our side. Where the buyer is stuck waiting on the store
 * (payment submitted, rejected, expired) the link moves into the status card;
 * without an opted-in number the copy never says "message the store".
 */

const BRAND_THEMES = new Set(["green", "amber", "red", "blue", "purple"]);

const loadOrder = cache(async (slug: string, token: string) => {
  return prisma.transaction.findFirst({
    where: {
      orderToken: token,
      source: "STOREFRONT",
      vendor: {
        slug,
        isActive: true,
        settings: { is: { publishStorefront: true } },
      },
    },
    select: {
      billNumber: true,
      createdAt: true,
      subtotalPaise: true,
      discountPaise: true,
      offerName: true,
      deliveryFeePaise: true,
      totalPaise: true,
      paymentMethod: true,
      paymentStatus: true,
      upiRef: true,
      paymentClaimedAt: true,
      paymentRejectedAt: true,
      fulfilmentStatus: true,
      fulfilmentType: true,
      outForDeliveryAt: true,
      deliveryAddress: true,
      notes: true,
      customerName: true,
      customerPhone: true,
      orderItems: {
        select: { id: true, name: true, qty: true, totalPaise: true },
      },
      drop: {
        select: {
          title: true,
          fulfilmentStartsAt: true,
          fulfilmentEndsAt: true,
          pickupNote: true,
        },
      },
      vendor: {
        select: {
          name: true,
          slug: true,
          isDemo: true,
          upiId: true,
          upiName: true,
          plan: true,
          planExpiresAt: true,
          trialEndsAt: true,
          settings: {
            select: {
              theme: true,
              whatsappNumber: true,
              acceptWhatsappOrders: true,
              fssaiNumber: true,
              menuPickupNote: true,
              razorpayKeyId: true,
              razorpayKeySecretEnc: true,
              razorpayWebhookSecretEnc: true,
            },
          },
        },
      },
    },
  });
});

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string; token: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const order = await loadOrder(params.slug, params.token);
  return {
    title: order ? `Your order — ${order.vendor.name}` : "Not found — AwaazOS",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-green-600/30 bg-green-600/10 text-green-800",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-900",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-foreground",
};

function ToneIcon({ tone }: { tone: StatusTone }) {
  const cls = "h-5 w-5 shrink-0";
  if (tone === "success") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (tone === "danger") return <XCircle className={cls} aria-hidden="true" />;
  return <Clock className={cls} aria-hidden="true" />;
}

type ProgressStep = { key: string; label: string; done: boolean };

/**
 * Placed → Paid → Confirmed → (On the way, deliveries only) → Collected /
 * Delivered (pay on delivery: no Paid step, payment happens at the last one). Static: each step is an icon plus
 * words ("Done" / "Now"), and the step the order is waiting on carries
 * `aria-current`. Colour only repeats what the words say.
 */
function OrderProgress({ steps }: { steps: ProgressStep[] }) {
  const firstOpen = steps.findIndex((s) => !s.done);
  const current = firstOpen === -1 ? steps.length - 1 : firstOpen;
  return (
    <ol
      aria-label="Order progress"
      className="flex gap-1 rounded-2xl border border-border/60 bg-background px-2 py-3 shadow-xs"
    >
      {steps.map((step, i) => {
        const isCurrent = i === current;
        const Icon = step.done ? Check : isCurrent ? CircleDot : Circle;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
          >
            <Icon
              className={cn("h-5 w-5 shrink-0", step.done || isCurrent ? "text-primary" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-xs leading-tight",
                isCurrent ? "font-bold text-foreground" : "font-semibold text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
              {step.done ? "Done" : isCurrent ? "Now" : <span className="sr-only">Not yet</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const WA_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-green-600/40 bg-background px-4 text-sm font-bold text-green-800 shadow-xs hover:bg-green-600/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export default async function StorefrontOrderPage(props: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ wa?: string | string[] }>;
}) {
  const params = await props.params;
  const viaWhatsapp = (await props.searchParams).wa === "1";
  const order = await loadOrder(params.slug, params.token);
  if (!order) notFound();

  const now = new Date();
  const state = orderDisplayState(
    {
      fulfilmentStatus: order.fulfilmentStatus,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      upiRef: order.upiRef,
      paymentClaimedAt: order.paymentClaimedAt,
      createdAt: order.createdAt,
    },
    now,
  );
  const { vendor, drop } = order;
  // Handed to a rider and not yet delivered. Who the rider is stays with the seller.
  const onTheWay = order.fulfilmentType === "DELIVERY" && order.outForDeliveryAt !== null;
  const status = orderStatusLabel(state, order.fulfilmentStatus, {
    menuOrder: !drop,
    fulfilmentType: order.fulfilmentType,
    outForDelivery: onTheWay,
  });
  const pickupNote = drop ? drop.pickupNote : (vendor.settings?.menuPickupNote ?? null);
  const slug = vendor.slug;
  const rawTheme = vendor.settings?.theme ?? "orange";
  const theme = BRAND_THEMES.has(rawTheme) ? rawTheme : undefined;

  const awaitingUpi = state === "AWAITING_PAYMENT" && order.paymentMethod === "UPI";
  // The seller answered "Not received" to an earlier "I've paid" and nothing has changed since.
  const paymentRejected =
    order.paymentRejectedAt !== null &&
    order.paymentMethod === "UPI" &&
    (state === "AWAITING_PAYMENT" || state === "EXPIRED");
  // Claimed with a bare tap: the buyer can still add the reference to help the seller.
  const canAddReference = state === "PAYMENT_SUBMITTED" && order.paymentMethod === "UPI" && !order.upiRef;
  const payeeName = vendor.upiName ?? vendor.name;
  const upiLink =
    awaitingUpi && vendor.upiId
      ? buildUpiDeepLink({
          upiId: vendor.upiId,
          name: payeeName,
          amountRupees: paiseToRupees(order.totalPaise),
          billRef: order.billNumber,
        })
      : null;
  const qrSrc = upiLink ? await qrSvgDataUrl(upiLink, 220) : "";
  const minsLeft = awaitingUpi ? holdMinutesLeft(order.createdAt, PENDING_HOLD_MINUTES, now) : 0;
  // A clock time, not a countdown: it stays right while the page sits open.
  const payBy = formatIstTime(new Date(order.createdAt.getTime() + PENDING_HOLD_MINUTES * 60_000));
  const payOnline = awaitingUpi && minsLeft > 0 && isOnlinePaymentEnabled(vendor, vendor.settings, now);

  const fulfilmentWindow = drop ? formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt) : null;
  const waNumber = buyerWhatsappNumber(vendor.settings);
  const waLink = waNumber
    ? whatsappChatLink(
        waNumber,
        formatWhatsAppOrderMessage({
          vendorName: vendor.name,
          billNumber: order.billNumber,
          items: order.orderItems,
          discountPaise: order.discountPaise,
          offerName: order.offerName,
          deliveryFeePaise: order.deliveryFeePaise,
          totalPaise: order.totalPaise,
          paymentMethod: order.paymentMethod === "CASH" ? "CASH" : "UPI",
          fulfilmentType: order.fulfilmentType,
          deliveryAddress: order.deliveryAddress,
          dropTitle: drop?.title ?? null,
          fulfilmentWindow,
          customerName: order.customerName,
          notes: order.notes,
          orderUrl: `${appBaseUrl()}/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(params.token)}`,
        }),
      )
    : null;
  // Chosen at checkout and still worth sending: lead with it.
  const waFirst = viaWhatsapp && !!waLink && order.fulfilmentStatus !== "CANCELLED";
  // Stuck waiting on the store: the way to reach it belongs next to the status.
  const waInStatus =
    !!waLink && !waFirst && (state === "PAYMENT_SUBMITTED" || state === "EXPIRED" || paymentRejected);

  const payOnDelivery = order.paymentMethod === "CASH";
  const isPickup = order.fulfilmentType === "PICKUP";
  const confirmed = order.fulfilmentStatus === "CONFIRMED";
  const handedOver = order.fulfilmentStatus === "DELIVERED";
  const lastStep = handedOverLabel(order.fulfilmentType);
  const steps: ProgressStep[] | null =
    state === "CANCELLED" || state === "EXPIRED"
      ? null
      : [
          { key: "placed", label: "Placed", done: true },
          ...(payOnDelivery ? [] : [{ key: "paid", label: "Paid", done: order.paymentStatus === "PAID" }]),
          { key: "confirmed", label: "Confirmed", done: confirmed || handedOver },
          ...(order.fulfilmentType !== "DELIVERY" ? [] : [{ key: "on-the-way", label: "On the way", done: onTheWay || handedOver }]),
          { key: "handed", label: payOnDelivery ? `${lastStep} · pay then` : lastStep, done: handedOver },
        ];
  const storeHref = `/s/${slug}`;

  return (
    <div data-theme={theme} className="min-h-screen bg-awaaz-cream/40">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to order
      </a>

      <header className="border-b border-border/50 bg-linear-to-b from-primary/15 to-background">
        <div className="mx-auto max-w-xl px-4 pb-6 pt-8 sm:px-6">
          <Link
            href={storeHref}
            className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {vendor.name}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-awaaz-charcoal">Your order</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {order.billNumber} · {formatIstDate(order.createdAt)} {formatIstTime(order.createdAt)}
          </p>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-xl space-y-5 px-4 py-6 sm:px-6">
        <section
          aria-labelledby="status-heading"
          className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3", TONE_CLASS[status.tone])}
        >
          <ToneIcon tone={status.tone} />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id="status-heading" className="text-base font-bold">
              {status.label}
            </h2>
            {status.hint ? <p className="text-sm">{status.hint}</p> : null}
            {state === "PAYMENT_SUBMITTED" ? (
              <p className="text-sm">The store checks its UPI app, then confirms here.</p>
            ) : null}
            {awaitingUpi && minsLeft > 0 ? (
              <p className="text-sm font-semibold">
                {drop ? `Pay by ${payBy} to keep your items.` : `Pay by ${payBy} to confirm your order.`}
              </p>
            ) : null}
            {paymentRejected ? (
              <p className="text-sm font-semibold">
                The store couldn&apos;t find your payment. Check your UPI app
                {awaitingUpi
                  ? ". If the money left your account, enter the UPI reference below."
                  : waLink
                    ? ". If the money left your account, message the store with the UPI reference."
                    : ". If the money left your account, keep the UPI reference from your payment app — the seller will need it."}
              </p>
            ) : null}
            {state === "EXPIRED" && order.paymentMethod === "UPI" && !paymentRejected ? (
              <p className="text-sm">
                {waLink
                  ? "If you already paid, message the store with your UPI reference."
                  : "If you already paid, keep the UPI reference from your payment app — the seller will need it."}
              </p>
            ) : null}
            {confirmed && (fulfilmentWindow || (isPickup && pickupNote)) ? (
              <p className="text-sm font-semibold">
                {isPickup ? "Pickup" : "Delivery"}
                {fulfilmentWindow ? ` · ${fulfilmentWindow}` : ""}
                {isPickup && pickupNote ? ` · ${pickupNote}` : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1 empty:hidden">
              {state === "EXPIRED" || state === "CANCELLED" ? (
                <Link
                  href={storeHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  Order again
                </Link>
              ) : null}
              {waInStatus && waLink ? (
                <a href={waLink} target="_blank" rel="noopener noreferrer" className={WA_BUTTON}>
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  Message the store on WhatsApp
                </a>
              ) : null}
            </div>
            <OrderRefresh
              auto={!handedOver && state !== "CANCELLED"}
              checkedAt={formatIstTime(now)}
              className="pt-1"
            />
          </div>
        </section>

        {steps ? <OrderProgress steps={steps} /> : null}

        {waFirst && waLink ? (
          <section
            aria-labelledby="wa-heading"
            className="space-y-3 rounded-2xl border border-green-600/30 bg-green-600/5 p-4 text-center sm:p-6"
          >
            <h2 id="wa-heading" className="font-display text-xl font-bold text-awaaz-charcoal">
              Send your order on WhatsApp
            </h2>
            <p className="text-sm text-muted-foreground">
              Your order is saved. Send it to {vendor.name} on WhatsApp. They&apos;ll reply there.
              {awaitingUpi ? " Then come back here to pay." : ""}
            </p>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-6 text-base font-bold text-white shadow-md hover:bg-green-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              Send order on WhatsApp
            </a>
          </section>
        ) : null}

        {awaitingUpi ? (
          <div className="rounded-2xl border border-primary/25 bg-background text-center shadow-xs">
            <section aria-labelledby="pay-heading" className="space-y-4 p-4 sm:p-6">
              <h2 id="pay-heading" className="font-display text-xl font-bold text-awaaz-charcoal">
                1 · Pay {formatINR(order.totalPaise)}
              </h2>
              {payOnline ? (
                <>
                  <RazorpayPayButton
                    slug={slug}
                    token={params.token}
                    amountLabel={formatINR(order.totalPaise)}
                    prefillName={order.customerName}
                    prefillContact={order.customerPhone}
                  />
                  {upiLink ? (
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      or pay directly with a UPI app
                    </p>
                  ) : null}
                </>
              ) : null}
              {upiLink ? (
                <>
                  <UpiPayOptions
                    upiLink={upiLink}
                    upiId={vendor.upiId ?? ""}
                    amountPaise={order.totalPaise}
                    genericLabel={`Pay ${formatINR(order.totalPaise)} with a UPI app`}
                    emphasis={payOnline ? "secondary" : "primary"}
                  />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Paying {payeeName} · ref {order.billNumber}
                  </p>
                  <details className="group overflow-hidden rounded-xl border border-border/60 text-left">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                      <QrCode className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="flex-1">Paying from another phone? Show QR</span>
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="border-t border-border/50 px-3 py-4 text-center">
                      <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-md ring-1 ring-border/60">
                        <UpiQrImage
                          src={qrSrc}
                          alt={`UPI QR code to pay ${formatINR(order.totalPaise)} to ${payeeName}`}
                          size={220}
                          sample={order.vendor.isDemo}
                        />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">Scan it with the phone you pay from.</p>
                    </div>
                  </details>
                </>
              ) : payOnline ? null : (
                <p className="text-sm text-muted-foreground">
                  {waLink
                    ? "The store hasn't added a UPI ID yet — message them to pay."
                    : "The store hasn't added a UPI ID yet, so it can't take a UPI payment here."}
                </p>
              )}
            </section>
            <section aria-labelledby="claim-heading" className="space-y-3 border-t border-border/50 p-4 sm:p-6">
              <h2 id="claim-heading" className="font-display text-lg font-bold text-awaaz-charcoal">
                2 · Tell the store you&apos;ve paid
              </h2>
              <PaidClaimForm slug={slug} token={params.token} requireReference={paymentRejected} />
            </section>
          </div>
        ) : null}

        {canAddReference ? (
          <section
            aria-labelledby="add-ref-heading"
            className="space-y-3 rounded-2xl border border-border/60 bg-background p-4 shadow-xs sm:p-6"
          >
            <h2 id="add-ref-heading" className="text-base font-bold text-awaaz-charcoal">
              Help the store find your payment
            </h2>
            <PaidClaimForm slug={slug} token={params.token} claimed />
          </section>
        ) : null}

        <section
          aria-labelledby="items-heading"
          className="rounded-2xl border border-border/60 bg-background shadow-xs"
        >
          <h2
            id="items-heading"
            className="flex items-center gap-2 border-b border-border/50 px-4 py-3 font-display text-base font-bold"
          >
            <ShoppingBag className="h-4 w-4 text-primary" aria-hidden="true" />
            {drop?.title ?? "Items"}
          </h2>
          <ul className="divide-y divide-border/50 px-4">
            {order.orderItems.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>
                  {i.qty} × {i.name}
                </span>
                <span className="font-mono tabular-nums">{formatINR(i.totalPaise)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-border/50 px-4 py-3 text-sm">
            {order.deliveryFeePaise > 0 || order.discountPaise > 0 ? (
              <div className="flex justify-between">
                <dt>Items</dt>
                <dd className="font-mono tabular-nums">{formatINR(order.subtotalPaise)}</dd>
              </div>
            ) : null}
            {order.discountPaise > 0 ? (
              <div className="flex justify-between gap-3 font-semibold text-primary">
                <dt className="min-w-0 break-words">{discountLabel(order.offerName)}</dt>
                <dd className="shrink-0 font-mono tabular-nums">−{formatINR(order.discountPaise)}</dd>
              </div>
            ) : null}
            {order.deliveryFeePaise > 0 ? (
              <div className="flex justify-between">
                <dt>Delivery fee</dt>
                <dd className="font-mono tabular-nums">{formatINR(order.deliveryFeePaise)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-bold">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{formatINR(order.totalPaise)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Payment</dt>
              <dd>{payOnDelivery ? payOnDeliveryLabel(order.fulfilmentType) : "UPI"}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="fulfil-heading"
          className="space-y-2 rounded-2xl border border-border/60 bg-background p-4 text-sm shadow-xs"
        >
          <h2 id="fulfil-heading" className="flex items-center gap-2 font-display text-base font-bold">
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            {order.fulfilmentType === "DELIVERY" ? "Delivery" : "Pickup"}
          </h2>
          {fulfilmentWindow ? <p className="font-semibold">{fulfilmentWindow}</p> : null}
          {order.fulfilmentType === "DELIVERY" && order.deliveryAddress ? (
            <p className="whitespace-pre-line text-muted-foreground">{order.deliveryAddress}</p>
          ) : null}
          {order.fulfilmentType === "PICKUP" && pickupNote ? (
            <p className="text-muted-foreground">{pickupNote}</p>
          ) : null}
          {order.notes ? (
            <p>
              <span className="font-semibold">Your note: </span>
              {order.notes}
            </p>
          ) : null}
        </section>

        <OtherCartsNotice slug={slug} vendorName={vendor.name} />

        {waLink && !waFirst && !waInStatus ? (
          <a href={waLink} target="_blank" rel="noopener noreferrer" className={cn(WA_BUTTON, "min-h-12 w-full px-6")}>
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            Message the store on WhatsApp
          </a>
        ) : null}

        <OrderLinkActions
          slug={slug}
          token={params.token}
          billNumber={order.billNumber}
          createdAt={order.createdAt.toISOString()}
          vendorName={vendor.name}
        />
      </main>

      <footer className="space-y-2 px-4 pb-10 pt-2 text-center text-xs text-muted-foreground">
        {vendor.settings?.fssaiNumber ? <p>FSSAI Lic. No. {vendor.settings.fssaiNumber}</p> : null}
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold hover:text-primary">
          Billing by AwaazOS — Bol. Bill. Becho.
        </Link>
      </footer>
    </div>
  );
}
