"use client";

import {
  AlertTriangle,
  Ban,
  Bike,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  IndianRupee,
  Loader2,
  MessageCircle,
  Phone,
  Send,
  ShoppingBag,
  Undo2,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { RiderHandoffButton } from "@/components/drops/orders/RiderHandoffButton";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { DeliveryRider } from "@/lib/delivery-riders";
import { formatINR } from "@/lib/currency";
import { discountLabel } from "@/lib/offers";
import {
  balanceDuePaise,
  DISPLAY_STATE_LABEL,
  availableOrderActions,
  firstName,
  markPaidNeedsConfirm,
  primaryOrderAction,
  whatsappHref,
  type BoardOrder,
  type OrderAction,
} from "@/lib/drops-board";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { cn } from "@/lib/utils";

/** Where an order came from: the everyday menu, or a drop (label = its title). */
export type OrderSource = { kind: "menu" | "drop"; label: string };

type Props = {
  order: BoardOrder;
  vendorName: string;
  /** Saved delivery riders: one "Send to <name>" link each on a delivery order. */
  riders?: DeliveryRider[];
  /** Stored drop status is FROZEN / FULFILLED: confirm & cancel are locked. */
  frozen: boolean;
  /** Shown on the card while the list mixes menu and drop orders. */
  source?: OrderSource;
  isNew: boolean;
  pendingAction: OrderAction | null;
  /** `riderName` goes with "dispatch" when the order was sent to a saved rider. */
  onAction: (orderId: string, action: OrderAction, opts?: { riderName?: string }) => void;
  /** Offer a selection checkbox (the order has at least one bulk action). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (orderId: string) => void;
  /** A bulk run is in progress: the card's own buttons wait. */
  locked?: boolean;
};

const STATE_STYLE: Record<BoardOrder["displayState"], string> = {
  PAID: "border-primary/40 bg-primary/10 text-foreground",
  DELIVERED: "border-border bg-muted text-foreground",
  PAY_ON_DELIVERY: "border-border bg-secondary text-secondary-foreground",
  PAYMENT_SUBMITTED: "border-amber-500/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  AWAITING_PAYMENT: "border-amber-500/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  CANCELLED: "border-destructive/40 bg-destructive/10 text-foreground",
  EXPIRED: "border-border bg-muted text-muted-foreground",
};

function StateIcon({ state }: { state: BoardOrder["displayState"] }) {
  const cls = "h-4 w-4 shrink-0";
  switch (state) {
    case "PAID":
    case "DELIVERED":
      return <CheckCircle2 className={cls} aria-hidden />;
    case "PAYMENT_SUBMITTED":
      return <AlertTriangle className={cls} aria-hidden />;
    case "AWAITING_PAYMENT":
    case "EXPIRED":
      return <Clock className={cls} aria-hidden />;
    case "PAY_ON_DELIVERY":
      return <IndianRupee className={cls} aria-hidden />;
    case "CANCELLED":
      return <XCircle className={cls} aria-hidden />;
  }
}

export function OrderCard({
  order,
  vendorName,
  riders = [],
  frozen,
  source,
  isNew,
  pendingAction,
  onAction,
  selectable = false,
  selected = false,
  onToggleSelect,
  locked = false,
}: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  // Orders that need nothing from the vendor right now are a two-line summary
  // until she opens them, so a long Confirmed / Delivered list stays scannable.
  // Per card and on this device only.
  const [open, setOpen] = useState(false);
  const collapsible = order.bucket !== "needs_action";
  const expanded = !collapsible || open;
  const busy = pendingAction !== null || locked;
  const customerLabel = order.customerName?.trim() || "Customer";
  const fs = order.fulfilmentStatus;
  const unpaid = order.paymentStatus !== "PAID";
  const isPickup = order.fulfilmentType === "PICKUP";
  const created = new Date(order.createdAt);
  const titleId = `order-${order.id}-title`;
  const detailsId = `order-${order.id}-details`;
  const itemCount = order.items.reduce((sum, it) => sum + it.qty, 0);
  const balanceDue = balanceDuePaise(order);
  const fulfilAt = order.fulfilAt ? new Date(order.fulfilAt) : null;

  const actions = availableOrderActions(order, frozen);
  const canConfirm = actions.has("confirm");
  const canMarkPaid = actions.has("mark_paid");
  const canRejectPayment = actions.has("reject_payment");
  const canDispatch = actions.has("dispatch");
  const canDeliver = actions.has("deliver");
  const outAt = order.outForDeliveryAt ? new Date(order.outForDeliveryAt) : null;
  const outForDelivery = outAt !== null && (fs === "PLACED" || fs === "CONFIRMED");
  // The buyer tapped "I've received my order" and it still waits on the seller (unpaid).
  const receivedAt = order.buyerReceivedAt ? new Date(order.buyerReceivedAt) : null;
  const buyerSaysReceived = receivedAt !== null && (fs === "PLACED" || fs === "CONFIRMED");
  const canUndeliver = actions.has("undeliver");
  const canCancel = actions.has("cancel");

  const deliverLabel =
    order.paymentMethod === "CASH" && unpaid
      ? `${isPickup ? "Picked up" : "Delivered"} · ${formatINR(order.totalPaise)} collected`
      : isPickup
        ? "Picked up"
        : "Delivered";

  // Exactly one primary button per order (`primaryOrderAction`); the rest are outline.
  const primary = primaryOrderAction(order, frozen);
  // "Not received" answers the same question as "Payment received", so it sits beside it.
  const pairedReject = primary === "mark_paid" && canRejectPayment;

  const run = (action: OrderAction) => {
    // Money: without a buyer's claim on the card there is nothing to check a stray tap against.
    if (action === "mark_paid" && markPaidNeedsConfirm(order)) setConfirmPaid(true);
    else onAction(order.id, action);
  };

  const BUTTONS: { action: OrderAction; show: boolean; label: string; icon: ReactNode }[] = [
    { action: "confirm", show: canConfirm, label: "Confirm", icon: <CheckCircle2 aria-hidden /> },
    {
      action: "mark_paid",
      show: canMarkPaid,
      // Being paid confirms a new order too (`markOrderPaid`); say so on the button.
      label: fs === "PLACED" ? "Payment received · Confirm" : "Payment received",
      icon: <IndianRupee aria-hidden />,
    },
    { action: "reject_payment", show: canRejectPayment, label: "Not received", icon: <XCircle aria-hidden /> },
    { action: "dispatch", show: canDispatch, label: "Out for delivery", icon: <Send aria-hidden /> },
    {
      action: "deliver",
      show: canDeliver,
      label: deliverLabel,
      icon: isPickup ? <ShoppingBag aria-hidden /> : <Bike aria-hidden />,
    },
  ];
  const shown = BUTTONS.filter((b) => b.show);
  // Primary first, its "Not received" partner next, then the others in their usual order.
  const rank = (a: OrderAction) => (a === primary ? 0 : pairedReject && a === "reject_payment" ? 1 : 2);
  const ordered = [...shown].sort((a, b) => rank(a.action) - rank(b.action));
  const primaryButton = shown.find((b) => b.action === primary) ?? null;

  const btn = ({ action, label, icon }: (typeof BUTTONS)[number]) => {
    const isPrimary = action === primary;
    return (
      <Button
        key={action}
        type="button"
        variant={isPrimary ? "default" : "outline"}
        className={cn(
          "flex-1 text-sm",
          isPrimary ? "min-h-12 font-semibold" : "min-h-11 font-medium",
          // The next step gets the full row, unless it shares it with "Not received".
          isPrimary && !pairedReject ? "basis-full" : "basis-[45%]",
          pairedReject && action === "reject_payment" && "min-h-12",
        )}
        disabled={busy}
        aria-busy={pendingAction === action}
        onClick={() => run(action)}
      >
        {pendingAction === action ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
        {label}
      </Button>
    );
  };

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "rounded-lg border bg-card p-4 text-card-foreground shadow-xs",
        isNew && "ring-2 ring-primary",
        selected && "border-primary bg-primary/5 ring-2 ring-primary",
        (order.displayState === "CANCELLED" || order.displayState === "EXPIRED") && "opacity-80",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        {selectable && onToggleSelect && (
          <label className="-ml-2 -mt-2 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-ring">
            <input
              type="checkbox"
              className="h-5 w-5 cursor-pointer accent-primary"
              checked={selected}
              onChange={() => onToggleSelect(order.id)}
              disabled={locked}
              aria-label={`Select order ${order.billNumber} from ${customerLabel}`}
            />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate text-base font-semibold">
            {customerLabel}
            {isNew && (
              <span className="ml-2 rounded bg-primary px-1.5 py-0.5 align-middle text-xs font-bold text-primary-foreground">
                New
              </span>
            )}
            {selected && (
              <span className="ml-2 rounded border border-primary px-1.5 py-0.5 align-middle text-xs font-bold">
                Selected
              </span>
            )}
            {order.isSample && (
              <span className="ml-2 rounded border border-border px-1.5 py-0.5 align-middle text-xs font-bold text-muted-foreground">
                Sample
              </span>
            )}
          </h3>
          {/* Two short lines on a phone (bill, then time) instead of one that wraps mid-number. */}
          {expanded && (
            <p className="font-mono text-xs text-muted-foreground">
              <span className="block sm:inline">{order.billNumber}</span>
              <span className="hidden sm:inline"> · </span>
              <span className="block sm:inline">
                {formatIstDate(created)} {formatIstTime(created)}
              </span>
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-bold tabular-nums">{formatINR(order.totalPaise)}</p>
          <p className="text-xs text-muted-foreground">{order.paymentMethod === "CASH" ? "Cash" : "UPI"}</p>
        </div>
      </header>

      {/*
        The second line of a collapsed card, and its 44px open / close control:
        status (icon + words), how many items, how it is handed over, and a flag
        when the buyer left a note, so nothing important hides behind the fold.
      */}
      {collapsible && (
        <div className="-mx-2 mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-11 min-w-0 flex-1 basis-48 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <span className="min-w-0 flex-1 text-muted-foreground">Hide details</span>
            ) : (
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <StateIcon state={order.displayState} />
                <span className="font-semibold">{DISPLAY_STATE_LABEL[order.displayState]}</span>
                <span className="text-muted-foreground">
                  · {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
                  {isPickup
                    ? "Pickup"
                    : outForDelivery
                      ? `Out for delivery${order.riderName ? ` with ${order.riderName}` : ""}`
                      : "Delivery"}
                </span>
                {buyerSaysReceived && <span className="font-semibold">· Customer got it</span>}
                {order.notes && (
                  <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    Has a note
                  </span>
                )}
                <span className="sr-only">. Show details</span>
              </span>
            )}
            {expanded ? (
              <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
          </button>
          {/*
            Handover day: the next step stays one tap away on a collapsed card. A
            sibling of the toggle, never inside it; same handler (and the same
            "mark paid?" check) as the full button.
          */}
          {!expanded && primaryButton && (
            <Button
              type="button"
              className="mr-2 min-h-11 shrink-0 text-sm font-semibold"
              disabled={busy}
              aria-busy={pendingAction === primaryButton.action}
              onClick={() => run(primaryButton.action)}
            >
              {pendingAction === primaryButton.action ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                primaryButton.icon
              )}
              {primaryButton.label}
            </Button>
          )}
        </div>
      )}

      <div id={detailsId} hidden={!expanded}>
        {expanded && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <p
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                  STATE_STYLE[order.displayState],
                )}
              >
                <StateIcon state={order.displayState} />
                {DISPLAY_STATE_LABEL[order.displayState]}
                {fs === "CONFIRMED" && order.displayState !== "DELIVERED" && " · Confirmed"}
                {fs === "PLACED" && order.displayState !== "EXPIRED" && " · Not confirmed yet"}
              </p>
              {source && (
                <p className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {source.kind === "drop" ? (
                    <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <UtensilsCrossed className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="sr-only">From: </span>
                  <span className="truncate">{source.label}</span>
                </p>
              )}
            </div>

            {order.displayState === "PAYMENT_SUBMITTED" && (
              <div className="mt-3 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                {order.upiRef ? (
                  <>
                    <p className="text-xs font-medium">Customer says they paid. Match this UTR in your UPI app:</p>
                    <p className="mt-1 select-all break-all font-mono text-lg font-bold tracking-wider">{order.upiRef}</p>
            </>
          ) : (
            <p className="text-xs font-medium">
              Customer says they paid {formatINR(order.totalPaise)}. Check your UPI app for that amount, then
              answer below.
            </p>
          )}
        </div>
      )}

      <ul className="mt-3 divide-y text-sm" aria-label="Items">
        {order.items.map((it) => (
          <li key={it.id} className="flex justify-between gap-2 py-1.5">
            <span>
              <span className="font-mono font-bold tabular-nums">{it.qty} ×</span> {it.name}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">{formatINR(it.totalPaise)}</span>
          </li>
        ))}
        {(order.discountPaise ?? 0) > 0 && (
          <li className="flex justify-between gap-2 py-1.5 font-semibold">
            <span className="min-w-0 break-words">{discountLabel(order.offerName)}</span>
            <span className="shrink-0 font-mono tabular-nums">−{formatINR(order.discountPaise ?? 0)}</span>
          </li>
        )}
        {order.deliveryFeePaise > 0 && (
          <li className="flex justify-between gap-2 py-1.5 text-muted-foreground">
            <span>Delivery fee</span>
            <span className="font-mono tabular-nums">{formatINR(order.deliveryFeePaise)}</span>
          </li>
        )}
        {balanceDue > 0 && (
          <li className="flex justify-between gap-2 py-1.5 font-semibold">
            <span>
              Advance paid {formatINR(order.advancePaidPaise ?? 0)} · Balance due
            </span>
            <span className="font-mono tabular-nums">{formatINR(balanceDue)}</span>
          </li>
        )}
      </ul>

      {order.notes && (
        <div className="mt-3 flex gap-2 rounded-md border-2 border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p>
            <span className="font-bold">Note: </span>
            <span className="whitespace-pre-wrap">{order.notes}</span>
          </p>
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 text-sm">
        {isPickup ? (
          <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Bike className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <p>
          <span className="font-semibold">{isPickup ? "Pickup" : "Delivery"}</span>
          {fulfilAt && (
            <span className="text-muted-foreground">
              {" "}
              · for {formatIstDate(fulfilAt)} {formatIstTime(fulfilAt)}
            </span>
          )}
          {!isPickup && order.deliveryAddress && (
            <span className="block whitespace-pre-wrap text-muted-foreground">{order.deliveryAddress}</span>
          )}
        </p>
      </div>

      {buyerSaysReceived && receivedAt && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Customer says they got it</span> · {formatIstTime(receivedAt)}
            {unpaid && <span className="block">Collect the payment, then tap Delivered.</span>}
          </span>
        </p>
      )}

      {outForDelivery && outAt && (
        <p className="mt-2 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold">
          <Send className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Out for delivery
            <span className="font-normal text-muted-foreground">
              {" "}
              · {formatIstTime(outAt)}
              {order.riderName ? ` · with ${order.riderName}` : ""}
            </span>
          </span>
        </p>
      )}

      {!isPickup && fs !== "CANCELLED" && fs !== "DELIVERED" && (
        <RiderHandoffButton
          order={order}
          vendorName={vendorName}
          riders={riders}
          // Sending it to a rider is handing it over: the order goes out for delivery.
          onSendToRider={busy ? undefined : (rider) => onAction(order.id, "dispatch", { riderName: rider.name })}
          className="mt-2"
        />
      )}

      {/* Next step first: one primary button, the other ways forward in outline under it. */}
      {ordered.length > 0 && <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">{ordered.map(btn)}</div>}

      {order.customerPhone && (
        <div className="mt-2 flex gap-2">
          <a
            href={`tel:${order.customerPhone}`}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Call ${order.customerName ?? "customer"}`}
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call
          </a>
          <a
            href={whatsappHref(
              order.customerPhone,
              `Hi ${firstName(order.customerName)}, about your order ${order.billNumber} from ${vendorName}: `,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`WhatsApp ${order.customerName ?? "customer"}`}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp
          </a>
        </div>
      )}

      {/*
        Going back or cancelling sits last, on its own line, small and at the
        start edge: away from the full-width buttons a thumb aims for. Cancel
        still asks before it does anything.
      */}
      {(canUndeliver || canCancel) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          {canUndeliver && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-2 text-sm first:-ml-2"
              disabled={busy}
              aria-busy={pendingAction === "undeliver"}
              onClick={() => onAction(order.id, "undeliver")}
            >
              {pendingAction === "undeliver" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Undo2 aria-hidden />
              )}
              Undo delivered
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-2 text-sm text-destructive first:-ml-2 hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              <Ban aria-hidden />
              Cancel order
            </Button>
          )}
        </div>
      )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmPaid}
        onOpenChange={setConfirmPaid}
        title={order.customerName?.trim() ? `Mark ${customerLabel}\u2019s order paid?` : "Mark this order paid?"}
        description={`${order.billNumber} · ${formatINR(order.totalPaise)}. ${
          order.paymentMethod === "CASH"
            ? "Only do this after you have the cash in hand."
            : "Only do this after you have seen the money in your UPI app."
        }${fs === "PLACED" ? " This also confirms the order." : ""}`}
        confirmLabel="Yes, mark paid"
        cancelLabel="Go back"
        destructive={false}
        onConfirm={() => onAction(order.id, "mark_paid")}
      />

      <ResponsiveDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Cancel {order.customerName?.trim() || "this"}&rsquo;s order?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {order.billNumber} · {formatINR(order.totalPaise)}. If they paid, refund them from your UPI
              app. Let them know on WhatsApp.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {order.paymentStatus === "PAID" && (
            <ResponsiveDialogBody>
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium">
                This order is marked paid. Cancelling removes {formatINR(order.totalPaise)} from your sales; you
                must refund the buyer yourself.
              </p>
            </ResponsiveDialogBody>
          )}
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirmCancel(false)}>
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={() => {
                setConfirmCancel(false);
                onAction(order.id, "cancel");
              }}
            >
              Yes, cancel order
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </article>
  );
}
