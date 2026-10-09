"use client";

import { ArrowDown } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCartHubEntry } from "@/components/storefront/CartHub";
import {
  CartBar,
  CheckoutSheet,
  NoPaymentNotice,
  QtyStepper,
  usePersistedCart,
  type BuyerPrefill,
  type FulfilmentType,
} from "@/components/storefront/StorefrontCheckout";
import { formatINRCompact, sumPaise } from "@/lib/currency";
import {
  cartStorageKey,
  maxOrderableQty,
  orderErrorMessage,
  stockLabel,
  type OrderApiError,
} from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

export type { BuyerPrefill } from "@/components/storefront/StorefrontCheckout";

/**
 * Cart + checkout for one Drop on the public storefront.
 *
 * The server is authoritative for everything that matters (price, stock,
 * per-order limits, cut-off): this component only mirrors those limits so the
 * buyer rarely hits a rejection, and maps the API's error codes to plain copy
 * when they do. No price ever leaves the browser — only dropItemId + qty.
 * The stepper, cart bar and checkout sheet are shared with MenuOrder
 * (StorefrontCheckout.tsx).
 */

export type DropOrderItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  priceInPaise: number;
  /** null = unlimited */
  remaining: number | null;
  perOrderLimit: number | null;
  /**
   * DOM id of the same item's row on the orderable everyday menu, when it is
   * there. A sold-out pre-order item then points at it instead of dead-ending.
   */
  menuAnchor: string | null;
};

export type DropOrderProps = {
  slug: string;
  dropId: string;
  dropTitle: string;
  items: DropOrderItem[];
  /** false → read-only preview (scheduled or closed drop) */
  orderable: boolean;
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  pickupNote: string | null;
  /** Fulfilment window label ("Sat, 5 Oct · 5:00 pm – 8:00 pm"), shown with Pickup at checkout. */
  pickupWindow?: string | null;
  payment: { upi: boolean; cod: boolean };
  /** The kitchen has a usable WhatsApp number (see CheckoutSheet). */
  whatsapp?: boolean;
  /**
   * Signed-in buyer's own saved details (lib/customer-auth.ts). Non-empty
   * fields win over the device's "remember me" values; absent for guests.
   */
  prefill?: BuyerPrefill | null;
};

export function DropOrder(props: DropOrderProps) {
  const {
    slug,
    dropId,
    dropTitle,
    items,
    orderable,
    fulfilmentTypes,
    deliveryFeePaise,
    pickupNote,
    pickupWindow,
    payment,
    whatsapp,
    prefill,
  } = props;
  const router = useRouter();

  // Stock learned from a sold_out rejection, until the refreshed props land.
  const [remainingOverride, setRemainingOverride] = useState<Record<string, number>>({});
  useEffect(() => setRemainingOverride({}), [items]);
  const [open, setOpen] = useState(false);
  const checkoutRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Saved per drop; discarded once the drop stops taking orders, clamped to
  // current stock and per-order limits on restore.
  const { cart, setCart, clearCart } = usePersistedCart({
    storageKey: cartStorageKey(slug, { kind: "drop", dropId }),
    accepting: orderable,
    maxFor: (id) => {
      const item = byId.get(id);
      return item ? maxOrderableQty(item.remaining, item.perOrderLimit) : null;
    },
  });

  function remainingFor(item: DropOrderItem): number | null {
    const o = remainingOverride[item.id];
    if (o === undefined) return item.remaining;
    return item.remaining === null ? o : Math.min(o, item.remaining);
  }

  function setQty(itemId: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  }

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(id), qty }))
    .filter((l): l is { item: DropOrderItem; qty: number } => !!l.item && l.qty > 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotalPaise = sumPaise(lines.map((l) => l.item.priceInPaise * l.qty));
  const canPay = payment.upi || payment.cod;

  // The page-level cart bar (CartHub) shows this cart next to any others.
  const inHub = useCartHubEntry({
    key: `drop:${dropId}`,
    label: `Pre-order · ${dropTitle}`,
    itemCount,
    subtotalPaise,
    canPay,
    onCheckout: () => setOpen(true),
    enabled: orderable,
  });

  /** Business rejection → cart correction + buyer copy. */
  function onRejected(err: OrderApiError): string {
    const item = err.dropItemId ? byId.get(err.dropItemId) : undefined;
    const message = orderErrorMessage(err, item?.name);

    if (err.error === "sold_out" && err.dropItemId) {
      const left = Math.max(0, err.remaining ?? 0);
      const id = err.dropItemId;
      setRemainingOverride((o) => ({ ...o, [id]: left }));
      setCart((c) => {
        const next = { ...c };
        if (left <= 0) delete next[id];
        else if ((next[id] ?? 0) > left) next[id] = left;
        return next;
      });
      router.refresh();
    } else if (err.error === "per_order_limit" && err.dropItemId && err.limit) {
      const id = err.dropItemId;
      const limit = err.limit;
      setCart((c) => ({ ...c, [id]: Math.min(c[id] ?? 0, limit) }));
    } else if (
      err.error === "drop_not_open" ||
      err.error === "drop_not_found" ||
      err.error === "item_not_found"
    ) {
      router.refresh();
    }
    return message;
  }

  return (
    <div>
      <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xs">
        {items.map((item) => {
          const remaining = remainingFor(item);
          const max = maxOrderableQty(remaining, item.perOrderLimit);
          const qty = cart[item.id] ?? 0;
          const soldOut = remaining !== null && remaining <= 0;
          const badge = stockLabel(remaining);
          return (
            <li key={item.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  className={cn(
                    "h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-border/60",
                    soldOut && "opacity-50",
                  )}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl",
                    soldOut && "opacity-50",
                  )}
                >
                  {item.emoji}
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-foreground">{item.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {formatINRCompact(item.priceInPaise)}
                  </span>
                  {badge ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                        soldOut ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                  {/* Only when the per-order cap actually binds — once stock is at or
                      below it, "Only N left" already says how many you can get. */}
                  {item.perOrderLimit !== null && !soldOut && (remaining === null || remaining > item.perOrderLimit) ? (
                    <span className="text-xs text-muted-foreground">Max {max} per order</span>
                  ) : null}
                </span>
              </span>

              {orderable && !soldOut ? (
                <QtyStepper itemName={item.name} qty={qty} max={max} onChange={(q) => setQty(item.id, q)} />
              ) : soldOut && item.menuAnchor ? (
                <a
                  href={`#${item.menuAnchor}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-bold text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={`${item.name} is on the everyday menu`}
                >
                  On menu
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>

      {orderable && !canPay ? <NoPaymentNotice /> : null}

      {orderable && !inHub ? (
        <CartBar
          itemCount={itemCount}
          subtotalPaise={subtotalPaise}
          canPay={canPay}
          onCheckout={() => setOpen(true)}
          buttonRef={checkoutRef}
        />
      ) : null}

      <CheckoutSheet
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        endpoint={`/api/s/${encodeURIComponent(slug)}/orders`}
        idPrefix={dropId}
        description={dropTitle}
        lines={lines.map((l) => ({
          id: l.item.id,
          name: l.item.name,
          priceInPaise: l.item.priceInPaise,
          qty: l.qty,
        }))}
        fulfilmentTypes={fulfilmentTypes}
        deliveryFeePaise={deliveryFeePaise}
        pickupNote={pickupNote}
        pickupWindow={pickupWindow}
        payment={payment}
        whatsapp={whatsapp}
        prefill={prefill}
        returnFocusRef={inHub ? undefined : checkoutRef}
        onOrdered={clearCart}
        buildBody={(d) => ({
          dropId,
          items: lines.map((l) => ({ dropItemId: l.item.id, qty: l.qty })),
          ...d,
        })}
        onRejected={onRejected}
      />
    </div>
  );
}
