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
import { ItemPrice } from "@/components/storefront/ItemPrice";
import { SizePicker } from "@/components/storefront/SizePicker";
import { OfferCartNote, OfferChips, offerCartNoteText } from "@/components/storefront/OfferNotes";
import { useStoreSearchMatch } from "@/components/storefront/StoreSearch";
import type { DeliveryArea } from "@/lib/delivery-areas";
import {
  cartLineKey,
  parseCartLineKey,
  variantLineName,
  variantPriceRange,
  type StoreSize,
} from "@/lib/item-variants";
import { applyOffers, offerSetAsideText, salePriceFor, withGiftsThatFit, type ResolvedOffer } from "@/lib/offers";
import { itemSearchText } from "@/lib/store-search";
import {
  cartStorageKey,
  maxOrderableQty,
  orderErrorMessage,
  stockLabel,
  type OrderApiError,
} from "@/lib/storefront-order";
import { cartAfterStockRejection, stockBadgeText, withStockOverride } from "@/lib/storefront-stock";
import { cn } from "@/lib/utils";

export type { BuyerPrefill } from "@/components/storefront/StorefrontCheckout";

/**
 * Cart + checkout for one Drop on the public storefront.
 *
 * The server is authoritative for everything that matters (price, stock,
 * per-order limits, cut-off): this component only mirrors those limits so the
 * buyer rarely hits a rejection, and maps the API's error codes to plain copy
 * when they do. No price ever leaves the browser — only dropItemId (+ variantId) + qty.
 *
 * An item with sizes or colours (lib/item-variants.ts rule 7) shows a picker;
 * each size is its own cart line ("dropItemId:variantId", `cartLineKey`). The
 * drop's cap and per-order limit are shared by the item's sizes, and each
 * tracked size is also capped by its own stock.
 * The stepper, cart bar and checkout sheet are shared with MenuOrder
 * (StorefrontCheckout.tsx).
 */

export type DropOrderItem = {
  id: string;
  /** The catalogue item behind this row; offers are matched on it. */
  menuItemId: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  /** One line under the name; null = none. */
  description?: string | null;
  priceInPaise: number;
  /** null = unlimited. The smaller of the drop's cap and the product's stock (lib/inventory.ts rule 6). */
  remaining: number | null;
  /**
   * Set when the product's stock is what limits this row (lib/storefront-stock.ts
   * `dropItemStock`): "Only N left" follows the store's low-stock line, null = no hint.
   * Absent = the drop's own cap, labelled from `remaining` as before.
   */
  onlyLeft?: number | null;
  perOrderLimit: number | null;
  /** Its available sizes / colours, priced from the drop (lib/item-variants.ts rule 7); absent = none. */
  sizes?: StoreSize[];
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
  /** The store's name, for the checkout's "you pay the store directly" line. */
  storeName?: string;
  items: DropOrderItem[];
  /** false → read-only preview (scheduled or closed drop) */
  orderable: boolean;
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  /** The store's delivery areas (lib/delivery-areas.ts); see CheckoutSheet. */
  deliveryAreas?: DeliveryArea[];
  pickupNote: string | null;
  /** Fulfilment window label ("Sat, 5 Oct · 5:00 pm – 8:00 pm"), shown with Pickup at checkout. */
  pickupWindow?: string | null;
  payment: { upi: boolean; cod: boolean; online: boolean };
  /** The store has a usable WhatsApp number (see CheckoutSheet). */
  whatsapp?: boolean;
  /** See CheckoutSheet. */
  theme?: string;
  notesExample?: string;
  /**
   * Signed-in buyer's own saved details (lib/customer-auth.ts). Non-empty
   * fields win over the device's "remember me" values; absent for guests.
   */
  prefill?: BuyerPrefill | null;
  /** Offers live on this drop (lib/offers.ts). Preview only; the server re-prices. */
  offers?: readonly ResolvedOffer[];
};

const NO_OFFERS: readonly ResolvedOffer[] = [];

export function DropOrder(props: DropOrderProps) {
  const {
    slug,
    dropId,
    dropTitle,
    storeName,
    items,
    orderable,
    fulfilmentTypes,
    deliveryFeePaise,
    deliveryAreas,
    pickupNote,
    pickupWindow,
    payment,
    whatsapp,
    theme,
    notesExample,
    prefill,
    offers = NO_OFFERS,
  } = props;
  const router = useRouter();

  // Stock learned from a sold_out rejection, until the refreshed props land:
  // per drop item (the drop's cap) and per size (that size's own stock).
  const [remainingOverride, setRemainingOverride] = useState<Record<string, number>>({});
  const [sizeOverride, setSizeOverride] = useState<Record<string, number>>({});
  useEffect(() => {
    setRemainingOverride({});
    setSizeOverride({});
  }, [items]);
  // The size each item's picker shows: the buyer's pick, else the first one that isn't sold out.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const checkoutRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  /** A cart key → its drop item and size; null when either is no longer offered. */
  const resolveKey = useMemo(
    () =>
      (key: string): { key: string; item: DropOrderItem; size: StoreSize | null } | null => {
        const { menuItemId: dropItemId, variantId } = parseCartLineKey(key);
        const item = byId.get(dropItemId);
        if (!item) return null;
        if (!item.sizes) return variantId ? null : { key, item, size: null };
        const size = variantId ? item.sizes.find((v) => v.id === variantId) : undefined;
        return size ? { key, item, size } : null;
      },
    [byId],
  );
  // The store page's search hides rows; the cart keeps what was added.
  const matchesSearch = useStoreSearchMatch();
  const visibleItems = useMemo(
    () => items.filter((i) => matchesSearch(itemSearchText({ name: i.name, description: i.description }, dropTitle))),
    [items, dropTitle, matchesSearch],
  );

  // Saved per drop; discarded once the drop stops taking orders, clamped to
  // current stock and per-order limits on restore.
  const { cart, setCart, clearCart } = usePersistedCart({
    storageKey: cartStorageKey(slug, { kind: "drop", dropId }),
    accepting: orderable,
    // On restore each line alone is clamped; sizes sharing the cap are re-checked by the server.
    maxFor: (key) => {
      const line = resolveKey(key);
      if (!line) return null;
      const shared = maxOrderableQty(line.item.remaining, line.item.perOrderLimit);
      const own = line.size?.stock?.maxQty;
      return own == null ? shared : Math.min(shared, Math.max(0, own));
    },
  });

  function remainingFor(item: DropOrderItem): number | null {
    const o = remainingOverride[item.id];
    if (o === undefined) return item.remaining;
    return item.remaining === null ? o : Math.min(o, item.remaining);
  }

  function sizeFor(item: DropOrderItem): StoreSize | null {
    if (!item.sizes || item.sizes.length === 0) return null;
    return (
      item.sizes.find((v) => v.id === picked[item.id]) ??
      item.sizes.find((v) => !v.stock?.soldOut) ??
      item.sizes[0]
    );
  }

  /** `key`: a cart line key (`cartLineKey`). */
  function setQty(key: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[key];
      else next[key] = qty;
      return next;
    });
  }

  /** Units of one drop item in the cart, every size together. */
  function inCartOf(itemId: string, except?: string): number {
    let n = 0;
    for (const [key, qty] of Object.entries(cart)) {
      if (key !== except && parseCartLineKey(key).menuItemId === itemId) n += qty;
    }
    return n;
  }

  /** Stepper ceiling for one line: what the drop item has left after its other sizes, and the size's own stock. */
  function maxForLine(item: DropOrderItem, size: StoreSize | null): number {
    const key = cartLineKey(item.id, size?.id);
    const shared = Math.max(0, maxOrderableQty(remainingFor(item), item.perOrderLimit) - inCartOf(item.id, key));
    const own = size ? withStockOverride(size.stock, sizeOverride[key])?.maxQty : null;
    return own == null ? shared : Math.min(shared, own);
  }

  const lines = Object.entries(cart).flatMap(([key, qty]) => {
    const line = qty > 0 ? resolveKey(key) : null;
    if (!line) return [];
    const priceInPaise = line.size?.priceInPaise ?? line.item.priceInPaise;
    const name = line.size ? variantLineName(line.item.name, line.size.label) : line.item.name;
    return [{ ...line, qty, priceInPaise, name }];
  });
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  // Same rule as the server (lib/drops.ts): the gift must still fit in the stock this cart leaves.
  // No gift with sizes yet (lib/item-variants.ts rule 5).
  const giftFits = (menuItemId: string, qty: number) =>
    items.some((i) => {
      if (i.menuItemId !== menuItemId || i.sizes) return false;
      const remaining = remainingFor(i);
      return remaining === null || remaining - inCartOf(i.id) >= qty;
    });
  const offered = applyOffers(
    lines.map((l) => ({
      key: l.key,
      menuItemId: l.item.menuItemId,
      priceInPaise: l.priceInPaise,
      qty: l.qty,
    })),
    withGiftsThatFit(offers, giftFits),
  );
  const appliedOffer = offered.applied;
  // What the cart bars show: items less the offer discount (delivery is added at checkout).
  const payablePaise = offered.totalPaise;
  const canPay = payment.upi || payment.cod;

  // The page-level cart bar (CartHub) shows this cart next to any others.
  const inHub = useCartHubEntry({
    key: `drop:${dropId}`,
    label: `Pre-order · ${dropTitle}`,
    itemCount,
    subtotalPaise: payablePaise,
    canPay,
    note: offerCartNoteText(offered),
    onCheckout: () => setOpen(true),
    enabled: orderable,
  });

  /** Business rejection → cart correction + buyer copy. */
  function onRejected(err: OrderApiError): string {
    const item = err.dropItemId ? byId.get(err.dropItemId) : undefined;
    const size = err.variantId ? item?.sizes?.find((v) => v.id === err.variantId) : undefined;
    const message = orderErrorMessage(err, item && size ? variantLineName(item.name, size.label) : item?.name);

    if (err.error === "sold_out" && err.dropItemId && err.variantId) {
      // One size ran out of its own stock.
      const key = cartLineKey(err.dropItemId, err.variantId);
      const left = Math.max(0, err.remaining ?? 0);
      setSizeOverride((o) => ({ ...o, [key]: left }));
      setCart((c) => cartAfterStockRejection(c, key, left));
      router.refresh();
    } else if (err.error === "sold_out" && err.dropItemId) {
      const left = Math.max(0, err.remaining ?? 0);
      const id = err.dropItemId;
      setRemainingOverride((o) => ({ ...o, [id]: left }));
      // With sizes, the cap is shared: at 0 every size goes; otherwise the buyer picks what to keep.
      if (item?.sizes) {
        if (left === 0) setCart((c) => dropItemLinesRemoved(c, id));
      } else {
        setCart((c) => cartAfterStockRejection(c, id, left));
      }
      router.refresh();
    } else if (err.error === "per_order_limit" && err.dropItemId && err.limit && !item?.sizes) {
      const id = err.dropItemId;
      const limit = err.limit;
      setCart((c) => ({ ...c, [id]: Math.min(c[id] ?? 0, limit) }));
    } else if (err.error === "size_required" && err.dropItemId) {
      // The seller added sizes after this cart was built: the plain line can't be placed.
      const id = err.dropItemId;
      setCart((c) => {
        const next = { ...c };
        delete next[id];
        return next;
      });
      router.refresh();
    } else if (err.error === "item_not_found" && err.dropItemId && err.variantId) {
      const key = cartLineKey(err.dropItemId, err.variantId);
      setCart((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      });
      router.refresh();
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
      {orderable ? <OfferChips offers={offers} /> : null}
      {/* No box or side padding of its own: the drop's card (DropSection) already
          pads the rows, and at 360 px a second inset leaves the name no room
          beside the 72 px photo and the stepper. */}
      <ul className="divide-y divide-border/50 border-y border-border/50">
        {visibleItems.map((item) => {
          const remaining = remainingFor(item);
          const size = sizeFor(item);
          const key = cartLineKey(item.id, size?.id);
          const max = maxForLine(item, size);
          const qty = cart[key] ?? 0;
          const soldOut = remaining !== null && remaining <= 0;
          const sizeStock = size ? withStockOverride(size.stock, sizeOverride[key]) : null;
          // The picked size has none of its own left: no stepper, the badge says so.
          const sizeSoldOut = sizeStock?.soldOut ?? false;
          // Product stock binds: never print a count above the store's low-stock line.
          const badge = sizeStock
            ? stockBadgeText(sizeStock)
            : item.onlyLeft !== undefined && remainingOverride[item.id] === undefined
              ? stockBadgeText({ soldOut, onlyLeft: item.onlyLeft })
              : stockLabel(remaining);
          const range = item.sizes ? variantPriceRange(item.priceInPaise, item.sizes) : null;
          const lineName = size ? variantLineName(item.name, size.label) : item.name;
          return (
            <li key={item.id} className="flex items-center gap-3 py-3 sm:gap-4">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  width={80}
                  height={80}
                  className={cn(
                    "h-20 w-20 shrink-0 rounded-xl object-cover ring-1 ring-border/60",
                    soldOut && "opacity-50",
                  )}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-3xl",
                    soldOut && "opacity-50",
                  )}
                >
                  {item.emoji}
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">{item.name}</span>
                {item.description ? (
                  <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.description}</span>
                ) : null}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <ItemPrice
                    priceInPaise={size?.priceInPaise ?? item.priceInPaise}
                    sale={
                      orderable
                        ? salePriceFor(offers, item.menuItemId, size?.priceInPaise ?? item.priceInPaise)
                        : null
                    }
                  />
                  {badge ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                        soldOut || sizeSoldOut ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                  {/* Only when the per-order cap actually binds — once stock is at or
                      below it, "Only N left" already says how many you can get. */}
                  {item.perOrderLimit !== null && !soldOut && (remaining === null || remaining > item.perOrderLimit) ? (
                    <span className="text-xs text-muted-foreground">Max {item.perOrderLimit} per order</span>
                  ) : null}
                </span>
                {item.sizes && item.sizes.length > 0 && !soldOut ? (
                  <SizePicker
                    itemId={item.id}
                    itemName={item.name}
                    sizes={item.sizes}
                    pickedId={size?.id ?? null}
                    onPick={(id) => setPicked((p) => ({ ...p, [item.id]: id }))}
                    inCart={item.sizes.flatMap((v) => {
                      const q = cart[cartLineKey(item.id, v.id)] ?? 0;
                      return q > 0 ? [`${v.label} × ${q}`] : [];
                    })}
                    priceNote={range ? "Price depends on the size" : null}
                  />
                ) : null}
              </span>

              {orderable && !soldOut && !sizeSoldOut ? (
                <QtyStepper itemName={lineName} qty={qty} max={max} onChange={(q) => setQty(key, q)} />
              ) : soldOut && item.menuAnchor ? (
                <a
                  href={`#${item.menuAnchor}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-bold text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={`${item.name} is in everyday items`}
                >
                  Order below
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>

      {orderable && !canPay ? <NoPaymentNotice /> : null}

      {orderable ? (
        <OfferCartNote offered={offered} inCartBar={inHub} />
      ) : null}

      {orderable && !inHub ? (
        <CartBar
          itemCount={itemCount}
          subtotalPaise={payablePaise}
          canPay={canPay}
          onCheckout={() => setOpen(true)}
          buttonRef={checkoutRef}
        />
      ) : null}

      <CheckoutSheet
        theme={theme}
        notesExample={notesExample}
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        endpoint={`/api/s/${encodeURIComponent(slug)}/orders`}
        idPrefix={dropId}
        description={dropTitle}
        storeName={storeName}
        lines={lines.map((l) => ({
          id: l.key,
          name: l.name,
          priceInPaise: l.priceInPaise,
          qty: l.qty,
          max: maxForLine(l.item, l.size),
        }))}
        onChangeQty={setQty}
        discount={appliedOffer}
        gift={offered.gift}
        setAsideNote={offerSetAsideText(offered)}
        fulfilmentTypes={fulfilmentTypes}
        deliveryFeePaise={deliveryFeePaise}
        deliveryAreas={deliveryAreas}
        pickupNote={pickupNote}
        pickupWindow={pickupWindow}
        payment={payment}
        whatsapp={whatsapp}
        prefill={prefill}
        returnFocusRef={inHub ? undefined : checkoutRef}
        onOrdered={clearCart}
        buildBody={(d) => ({
          dropId,
          items: lines.map((l) => ({ dropItemId: l.item.id, ...(l.size ? { variantId: l.size.id } : {}), qty: l.qty })),
          ...d,
        })}
        onRejected={onRejected}
      />
    </div>
  );
}

/** The cart without any line of one drop item (every size of it). */
function dropItemLinesRemoved(cart: Record<string, number>, dropItemId: string): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, qty] of Object.entries(cart)) {
    if (parseCartLineKey(key).menuItemId !== dropItemId) next[key] = qty;
  }
  return next;
}
