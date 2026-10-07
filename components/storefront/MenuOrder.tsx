"use client";

import { MapPin, ShoppingBag, Sparkles, Truck } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  CartBar,
  CheckoutSheet,
  NoPaymentNotice,
  QtyStepper,
  usePersistedCart,
  type BuyerPrefill,
  type FulfilmentType,
} from "@/components/storefront/StorefrontCheckout";
import { formatINR, sumPaise } from "@/lib/currency";
import {
  cartStorageKey,
  fulfilmentOptionsLabel,
  maxOrderableQty,
  orderErrorMessage,
  toMenuOrderLines,
  type OrderApiError,
} from "@/lib/storefront-order";

/**
 * "Order from menu" on the public storefront: the vendor's everyday menu with
 * steppers, one cart, and the same checkout sheet drops use. Rendered only when
 * `VendorSettings.acceptMenuOrders` is on; otherwise the page keeps its
 * read-only menu rows.
 *
 * No stock, no cut-off: only items the server already filtered to
 * `isAvailable && showOnline` reach this component (so a restored cart drops
 * anything no longer offered online), and app/api/s/[slug]/menu-orders
 * re-checks both and re-reads every price. Only menuItemId + qty leave the
 * browser. Not rendered at all while an open drop hides the everyday menu.
 */

export type MenuOrderItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  priceInPaise: number;
  isPopular: boolean;
};

export type MenuOrderCategory = {
  category: string;
  /** DOM id for the category heading (jump-bar target). */
  anchor: string;
  items: MenuOrderItem[];
};

export type MenuOrderProps = {
  slug: string;
  vendorName: string;
  categories: MenuOrderCategory[];
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  pickupNote: string | null;
  payment: { upi: boolean; cod: boolean };
  prefill?: BuyerPrefill | null;
};

export function MenuOrder(props: MenuOrderProps) {
  const { slug, vendorName, categories, fulfilmentTypes, deliveryFeePaise, pickupNote, payment, prefill } =
    props;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const checkoutRef = useRef<HTMLButtonElement>(null);
  const refreshOnCloseRef = useRef(false);

  const byId = useMemo(() => {
    const m = new Map<string, MenuOrderItem>();
    for (const c of categories) for (const i of c.items) m.set(i.id, i);
    return m;
  }, [categories]);

  // Saved per store; items no longer on the (available + online) menu are dropped on restore.
  const max = maxOrderableQty(null, null);
  const { cart, setCart, clearCart } = usePersistedCart({
    storageKey: cartStorageKey(slug, { kind: "menu" }),
    accepting: true,
    maxFor: (id) => (byId.has(id) ? max : null),
  });

  function setQty(itemId: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  }

  // Drop cart lines whose item vanished after a refresh (made unavailable).
  const lines = toMenuOrderLines(cart)
    .map((l) => ({ item: byId.get(l.menuItemId), qty: l.qty }))
    .filter((l): l is { item: MenuOrderItem; qty: number } => !!l.item);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotalPaise = sumPaise(lines.map((l) => l.item.priceInPaise * l.qty));
  const canPay = payment.upi || payment.cod;

  function onRejected(err: OrderApiError): string {
    const item = err.menuItemId ? byId.get(err.menuItemId) : undefined;
    const message = orderErrorMessage(err, item?.name);
    if (err.error === "item_not_found" && err.menuItemId) {
      const id = err.menuItemId;
      setCart((c) => {
        const next = { ...c };
        delete next[id];
        return next;
      });
      router.refresh();
    } else if (err.error === "menu_paused_for_drop") {
      // A drop opened while this cart was being built. The menu cart can't be
      // placed until it closes, so drop it (memory + storage). The refreshed
      // page has no everyday menu — this component and its sheet unmount — so
      // refresh only once the buyer has read the message and closed the sheet.
      clearCart();
      refreshOnCloseRef.current = true;
    } else if (err.error === "menu_orders_disabled" || err.error === "fulfilment_unavailable") {
      router.refresh();
    }
    return message;
  }

  function onSheetOpenChange(next: boolean) {
    setOpen(next);
    if (!next && refreshOnCloseRef.current) {
      refreshOnCloseRef.current = false;
      router.refresh();
    }
  }

  return (
    <div id="menu-order" className="scroll-mt-16">
      <div className="mb-6 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-background px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-bold text-awaaz-charcoal">
          <ShoppingBag className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Order online · {fulfilmentOptionsLabel(fulfilmentTypes)}
        </p>
        <ul className="mt-1.5 space-y-1 text-muted-foreground">
          {fulfilmentTypes.includes("DELIVERY") ? (
            <li className="flex items-start gap-2">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {deliveryFeePaise > 0 ? `Delivery fee ${formatINR(deliveryFeePaise)}` : "Free delivery"}
              </span>
            </li>
          ) : null}
          {fulfilmentTypes.includes("PICKUP") && pickupNote ? (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Pickup: {pickupNote}</span>
            </li>
          ) : null}
          <li>Tap + to add items, then check out.</li>
        </ul>
      </div>

      <div className="space-y-8">
        {categories.map(({ category, anchor, items }) => (
          <section key={anchor} aria-labelledby={anchor}>
            <div className="mb-3 flex scroll-mt-16 items-baseline gap-3">
              <h3 id={anchor} className="font-display text-base font-bold text-awaaz-charcoal">
                {category}
              </h3>
              <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
            </div>
            <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-border/60"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl"
                    >
                      {item.emoji}
                    </span>
                  )}

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold text-foreground">{item.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-mono font-bold tabular-nums text-foreground">
                        {formatINR(item.priceInPaise)}
                      </span>
                      {item.isPopular ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          Popular
                        </span>
                      ) : null}
                    </span>
                  </span>

                  <QtyStepper
                    itemName={item.name}
                    qty={cart[item.id] ?? 0}
                    max={max}
                    onChange={(q) => setQty(item.id, q)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {!canPay ? <NoPaymentNotice /> : null}

      <CartBar
        itemCount={itemCount}
        subtotalPaise={subtotalPaise}
        canPay={canPay}
        onCheckout={() => setOpen(true)}
        buttonRef={checkoutRef}
      />

      <CheckoutSheet
        open={open}
        onOpenChange={onSheetOpenChange}
        slug={slug}
        endpoint={`/api/s/${encodeURIComponent(slug)}/menu-orders`}
        idPrefix="menu"
        description={vendorName}
        lines={lines.map((l) => ({
          id: l.item.id,
          name: l.item.name,
          priceInPaise: l.item.priceInPaise,
          qty: l.qty,
        }))}
        fulfilmentTypes={fulfilmentTypes}
        deliveryFeePaise={deliveryFeePaise}
        pickupNote={pickupNote}
        payment={payment}
        prefill={prefill}
        returnFocusRef={checkoutRef}
        onOrdered={clearCart}
        buildBody={(d) => ({
          items: lines.map((l) => ({ menuItemId: l.item.id, qty: l.qty })),
          ...d,
        })}
        onRejected={onRejected}
      />
    </div>
  );
}
