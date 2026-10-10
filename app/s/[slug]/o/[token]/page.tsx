import type { Metadata } from "next";
import { CheckCircle2, Clock, MapPin, MessageCircle, ShoppingBag, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { OtherCartsNotice } from "@/components/storefront/OtherCartsNotice";
import { RazorpayPayButton } from "@/components/storefront/RazorpayPayButton";
import { UpiPayOptions } from "@/components/storefront/UpiPayOptions";
import { UtrForm } from "@/components/storefront/UtrForm";
import { formatINR, paiseToRupees } from "@/lib/currency";
import { orderDisplayState, PENDING_HOLD_MINUTES } from "@/lib/drops";
import { formatFulfilmentWindow, formatIstDate, formatIstTime } from "@/lib/drops-time";
import {
  buyerWhatsappNumber,
  formatWhatsAppOrderMessage,
  holdMinutesLeft,
  orderStatusLabel,
  whatsappChatLink,
  type StatusTone,
} from "@/lib/storefront-order";
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
 * `upi://` has no app chooser; plus copy-UPI-ID / copy-amount. The QR below is
 * for scanning from a second phone. Only the vendor VPA and total reach it.
 *
 * When the kitchen has connected her own Razorpay account (PRO plan), "Pay
 * online" is offered above the UPI intent/QR. The buyer's own name and phone
 * are handed to that button only to prefill Razorpay Checkout. Razorpay
 * credentials are selected for presence checks only — never rendered or passed
 * to a client component.
 *
 * Menu orders ("Order from menu", lib/menu-orders.ts) have `drop = null`: no
 * drop title or fulfilment window; a pickup shows the vendor's
 * `menuPickupNote` instead of the drop's.
 *
 * WhatsApp: the kitchen's opted-in number gets a wa.me link pre-filled with
 * the whole order (`formatWhatsAppOrderMessage`). `?wa=1` — set when the buyer
 * chose "Place order & send on WhatsApp" at checkout — puts that link at the
 * top as the next step. The buyer sends it from their own WhatsApp; nothing is
 * sent from our side.
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
      deliveryFeePaise: true,
      totalPaise: true,
      paymentMethod: true,
      paymentStatus: true,
      upiRef: true,
      fulfilmentStatus: true,
      fulfilmentType: true,
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
          upiId: true,
          upiName: true,
          plan: true,
          planExpiresAt: true,
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
      createdAt: order.createdAt,
    },
    now,
  );
  const { vendor, drop } = order;
  const status = orderStatusLabel(state, order.fulfilmentStatus, { menuOrder: !drop });
  const pickupNote = drop ? drop.pickupNote : (vendor.settings?.menuPickupNote ?? null);
  const slug = vendor.slug;
  const rawTheme = vendor.settings?.theme ?? "orange";
  const theme = BRAND_THEMES.has(rawTheme) ? rawTheme : undefined;

  const awaitingUpi = state === "AWAITING_PAYMENT" && order.paymentMethod === "UPI";
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
  const payOnline = awaitingUpi && minsLeft > 0 && isOnlinePaymentEnabled(vendor, vendor.settings, now);

  const waNumber = buyerWhatsappNumber(vendor.settings);
  const waLink = waNumber
    ? whatsappChatLink(
        waNumber,
        formatWhatsAppOrderMessage({
          vendorName: vendor.name,
          billNumber: order.billNumber,
          items: order.orderItems,
          deliveryFeePaise: order.deliveryFeePaise,
          totalPaise: order.totalPaise,
          paymentMethod: order.paymentMethod === "CASH" ? "CASH" : "UPI",
          fulfilmentType: order.fulfilmentType,
          deliveryAddress: order.deliveryAddress,
          dropTitle: drop?.title ?? null,
          fulfilmentWindow: drop ? formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt) : null,
          customerName: order.customerName,
          notes: order.notes,
          orderUrl: `${appBaseUrl()}/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(params.token)}`,
        }),
      )
    : null;
  // Chosen at checkout and still worth sending: lead with it.
  const waFirst = viaWhatsapp && !!waLink && order.fulfilmentStatus !== "CANCELLED";

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
            href={`/s/${slug}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            ← {vendor.name}
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
          <div>
            <h2 id="status-heading" className="text-base font-bold">
              {status.label}
            </h2>
            {status.hint ? <p className="text-sm">{status.hint}</p> : null}
            {awaitingUpi && minsLeft > 0 ? (
              <p className="text-sm">
                {drop
                  ? `Hold expires in ${minsLeft} min — pay before then to keep your items.`
                  : `Pay within ${minsLeft} min to confirm your order.`}
              </p>
            ) : null}
            {state === "EXPIRED" && order.paymentMethod === "UPI" ? (
              <p className="text-sm">If you already paid, message the kitchen with your UPI reference.</p>
            ) : null}
          </div>
        </section>

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
          <section
            aria-labelledby="pay-heading"
            className="space-y-4 rounded-2xl border border-primary/25 bg-background p-4 text-center shadow-xs sm:p-6"
          >
            <h2 id="pay-heading" className="font-display text-xl font-bold text-awaaz-charcoal">
              Pay {formatINR(order.totalPaise)}
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
                <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-md ring-1 ring-border/60">
                  <Image
                    src={qrSrc}
                    alt={`UPI QR code to pay ${formatINR(order.totalPaise)} to ${payeeName}`}
                    width={220}
                    height={220}
                    unoptimized
                    className="rounded-lg"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Paying from another phone? Scan this QR with it.
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Paying {payeeName} · ref {order.billNumber}
                </p>
              </>
            ) : payOnline ? null : (
              <p className="text-sm text-muted-foreground">
                The kitchen hasn&apos;t added a UPI ID yet — message them to pay.
              </p>
            )}
            <UtrForm slug={slug} token={params.token} />
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
            {order.deliveryFeePaise > 0 ? (
              <>
                <div className="flex justify-between">
                  <dt>Items</dt>
                  <dd className="font-mono tabular-nums">{formatINR(order.subtotalPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Delivery fee</dt>
                  <dd className="font-mono tabular-nums">{formatINR(order.deliveryFeePaise)}</dd>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-base font-bold">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{formatINR(order.totalPaise)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Payment</dt>
              <dd>{order.paymentMethod === "CASH" ? "Pay on delivery" : "UPI"}</dd>
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
          {drop ? (
            <p className="font-semibold">
              {formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt)}
            </p>
          ) : null}
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

        {waLink && !waFirst ? (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-green-600/40 bg-background px-6 text-sm font-bold text-green-800 shadow-xs hover:bg-green-600/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            Message the kitchen on WhatsApp
          </a>
        ) : null}

        <p className="text-center text-xs text-muted-foreground">
          Bookmark this page to check your order status.
        </p>
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
