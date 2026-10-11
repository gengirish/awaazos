"use client";

import {
  AlertTriangle,
  Ban,
  Bike,
  CheckCircle2,
  Clock,
  IndianRupee,
  Loader2,
  MessageCircle,
  Phone,
  ShoppingBag,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/currency";
import {
  DISPLAY_STATE_LABEL,
  availableOrderActions,
  firstName,
  whatsappHref,
  type BoardOrder,
  type OrderAction,
} from "@/lib/drops-board";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { cn } from "@/lib/utils";

type Props = {
  order: BoardOrder;
  vendorName: string;
  /** Stored drop status is FROZEN / FULFILLED: confirm & cancel are locked. */
  frozen: boolean;
  isNew: boolean;
  pendingAction: OrderAction | null;
  onAction: (orderId: string, action: OrderAction) => void;
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
  frozen,
  isNew,
  pendingAction,
  onAction,
  selectable = false,
  selected = false,
  onToggleSelect,
  locked = false,
}: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busy = pendingAction !== null || locked;
  const customerLabel = order.customerName?.trim() || "Customer";
  const fs = order.fulfilmentStatus;
  const unpaid = order.paymentStatus !== "PAID";
  const isPickup = order.fulfilmentType === "PICKUP";
  const created = new Date(order.createdAt);
  const titleId = `order-${order.id}-title`;

  const actions = availableOrderActions(order, frozen);
  const canConfirm = actions.has("confirm");
  const canMarkPaid = actions.has("mark_paid");
  const canRejectPayment = actions.has("reject_payment");
  const canDeliver = actions.has("deliver");
  const canUndeliver = actions.has("undeliver");
  const canCancel = actions.has("cancel");

  const deliverLabel =
    order.paymentMethod === "CASH" && unpaid
      ? `${isPickup ? "Picked up" : "Delivered"} · ${formatINR(order.totalPaise)} collected`
      : isPickup
        ? "Picked up"
        : "Delivered";

  const btn = (action: OrderAction, label: string, icon: ReactNode, variant: "default" | "outline" | "secondary" = "outline") => (
    <Button
      type="button"
      variant={variant}
      className="min-h-11 flex-1 basis-[45%] text-sm"
      disabled={busy}
      aria-busy={pendingAction === action}
      onClick={() => onAction(order.id, action)}
    >
      {pendingAction === action ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {label}
    </Button>
  );

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
          </h3>
          <p className="font-mono text-xs text-muted-foreground">
            {order.billNumber} · {formatIstDate(created)} {formatIstTime(created)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold tabular-nums">{formatINR(order.totalPaise)}</p>
          <p className="text-xs text-muted-foreground">{order.paymentMethod === "CASH" ? "Cash" : "UPI"}</p>
        </div>
      </header>

      <p
        className={cn(
          "mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          STATE_STYLE[order.displayState],
        )}
      >
        <StateIcon state={order.displayState} />
        {DISPLAY_STATE_LABEL[order.displayState]}
        {fs === "CONFIRMED" && order.displayState !== "DELIVERED" && " · Confirmed"}
        {fs === "PLACED" && order.displayState !== "EXPIRED" && " · New"}
      </p>

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
        {order.deliveryFeePaise > 0 && (
          <li className="flex justify-between gap-2 py-1.5 text-muted-foreground">
            <span>Delivery fee</span>
            <span className="font-mono tabular-nums">{formatINR(order.deliveryFeePaise)}</span>
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
          {!isPickup && order.deliveryAddress && (
            <span className="block whitespace-pre-wrap text-muted-foreground">{order.deliveryAddress}</span>
          )}
        </p>
      </div>

      {order.customerPhone && (
        <div className="mt-3 flex gap-2">
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

      {(canConfirm || canMarkPaid || canRejectPayment || canDeliver || canUndeliver || canCancel) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          {canConfirm && btn("confirm", "Confirm", <CheckCircle2 aria-hidden />, "default")}
          {canMarkPaid &&
            btn(
              "mark_paid",
              "Payment received",
              <IndianRupee aria-hidden />,
              order.displayState === "PAYMENT_SUBMITTED" ? "default" : "outline",
            )}
          {canRejectPayment && btn("reject_payment", "Not received", <XCircle aria-hidden />)}
          {canDeliver && btn("deliver", deliverLabel, isPickup ? <ShoppingBag aria-hidden /> : <Bike aria-hidden />, "secondary")}
          {canUndeliver && btn("undeliver", "Undo delivered", <Undo2 aria-hidden />)}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 basis-[45%] border-destructive/50 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              <Ban aria-hidden />
              Cancel order
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.customerName?.trim() || "this"}&rsquo;s order?</DialogTitle>
            <DialogDescription>
              {order.billNumber} · {formatINR(order.totalPaise)}. If they paid, refund them from your UPI
              app. Let them know on WhatsApp.
            </DialogDescription>
          </DialogHeader>
          {order.paymentStatus === "PAID" && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium">
              This order is marked paid. Cancelling removes {formatINR(order.totalPaise)} from your sales; you
              must refund the buyer yourself.
            </p>
          )}
          <DialogFooter className="gap-2">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
