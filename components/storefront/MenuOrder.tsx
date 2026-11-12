"use client";

import { CalendarClock, MapPin, Sparkles, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCartHubEntry } from "@/components/storefront/CartHub";
import { SizePicker } from "@/components/storefront/SizePicker";
import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import { useStoreSearchMatch } from "@/components/storefront/StoreSearch";
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
import { OfferCartNote, OfferChips, offerCartNoteText } from "@/components/storefront/OfferNotes";
import { deliveryAreaSummary, type DeliveryArea } from "@/lib/delivery-areas";
import {
  allSizesSoldOut,
  cartLineKey,
  parseCartLineKey,
  variantLineName,
  variantPriceRange,
  type StoreSize,
} from "@/lib/item-variants";
import type { MenuSlotRule } from "@/lib/menu-slots";
import { applyOffers, offerSetAsideText, salePriceFor, type ResolvedOffer } from "@/lib/offers";
import { itemSearchText } from "@/lib/store-search";
import {
  cartStorageKey,
  maxOrderableQty,
  menuItemAnchor,
  orderErrorMessage,
  restoreCartLines,
  sameCartLines,
  toMenuOrderLines,
  type OrderApiError,
} from "@/lib/storefront-order";
import {
  cartAfterStockRejection,
  stockBadgeText,
  withStockOverride,
  type StorefrontStock,
} from "@/lib/storefront-stock";
import { cn } from "@/lib/utils";

/**
 * "Order from menu" on the public storefront: the vendor's everyday menu with
 * steppers, one cart, and the same checkout sheet drops use. Rendered only when
 * `VendorSettings.acceptMenuOrders` is on; otherwise the page keeps its
 * read-only menu rows.
 *
 * No cut-off. Stock only for items the seller tracks (lib/inventory.ts):
 * `stock` says "Sold out" / "Only N left" and caps the stepper, and an
 * `out_of_stock` rejection cuts the cart down to what is left. Only items the server already filtered to
 * `isAvailable && showOnline` reach this component (so a restored cart drops
 * anything no longer offered online), and app/api/s/[slug]/menu-orders
 * re-checks both and re-reads every price. Only menuItemId (+ variantId) + qty
 * leave the browser. Not rendered at all while an open drop hides the everyday menu.
 *
 * An item with sizes or colours (lib/item-variants.ts) shows a picker; the
 * stepper, price and stock badge follow the picked size, and each size is its
 * own cart line ("itemId:variantId", `cartLineKey`).
 */

export type MenuOrderItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  priceInPaise: number;
  /** Selling unit ("kg", "piece"), shown after the price; null = none. */
  unit?: string | null;
  isPopular: boolean;
  /** One line under the name; null = none. */
  description?: string | null;
  /** Product stock (lib/storefront-stock.ts); null / absent = not tracked. */
  stock?: StorefrontStock | null;
  /** Its available sizes / colours (lib/item-variants.ts); absent = it has none. */
  sizes?: StoreSize[];
};

/** One cart line resolved against the page: the item, and its size when it has them. */
type CartLine = { key: string; item: MenuOrderItem; size: StoreSize | null };

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
  /** The store's delivery areas (lib/delivery-areas.ts); see CheckoutSheet. */
  deliveryAreas?: DeliveryArea[];
  pickupNote: string | null;
  /** The store's weekly pickup / delivery slots (lib/menu-slots.ts); empty = checkout asks no "when". */
  slotRules?: MenuSlotRule[];
  /** "Tomorrow · 12–2 pm": the first slot open now, worked out on the server render. */
  nextSlotLabel?: string | null;
  payment: { upi: boolean; cod: boolean; online: boolean };
  /** The store has a usable WhatsApp number (see CheckoutSheet). */
  whatsapp?: boolean;
  prefill?: BuyerPrefill | null;
  /** See CheckoutSheet. */
  theme?: string;
  notesExample?: string;
  /** Offers live on menu orders (lib/offers.ts). Preview only; the server re-prices. */
  offers?: readonly ResolvedOffer[];
  /** Rows for a kitchen's menu; a photo gallery (two columns, tap to enlarge) for goods. */
  layout?: "list" | "gallery";
};

const NO_OFFERS: readonly ResolvedOffer[] = [];

export function MenuOrder(props: MenuOrderProps) {
  const {
    slug,
    vendorName,
    categories,
    fulfilmentTypes,
    deliveryFeePaise,
    deliveryAreas = [],
    pickupNote,
    slotRules,
    nextSlotLabel,
    payment,
    whatsapp,
    prefill,
    theme,
    notesExample,
    offers = NO_OFFERS,
    layout = "list",
  } = props;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const checkoutRef = useRef<HTMLButtonElement>(null);
  const refreshOnCloseRef = useRef(false);

  const byId = useMemo(() => {
    const m = new Map<string, MenuOrderItem>();
    for (const c of categories) for (const i of c.items) m.set(i.id, i);
    return m;
  }, [categories]);
  /** A cart key → its item and size; null when either is no longer offered. */
  const resolveKey = useMemo(
    () =>
      (key: string): CartLine | null => {
        const { menuItemId, variantId } = parseCartLineKey(key);
        const item = byId.get(menuItemId);
        if (!item) return null;
        if (!item.sizes) return variantId ? null : { key, item, size: null };
        const size = variantId ? item.sizes.find((v) => v.id === variantId) : undefined;
        return size ? { key, item, size } : null;
      },
    [byId],
  );

  // The size each item's picker shows: the buyer's pick, else the first one that isn't sold out.
  const [picked, setPicked] = useState<Record<string, string>>({});
  function sizeFor(item: MenuOrderItem): StoreSize | null {
    if (!item.sizes || item.sizes.length === 0) return null;
    return (
      item.sizes.find((v) => v.id === picked[item.id]) ??
      item.sizes.find((v) => !v.stock?.soldOut) ??
      item.sizes[0]
    );
  }

  // The store page's search hides rows (and emptied categories); the cart keeps
  // whatever was added, so hidden rows still check out.
  const matchesSearch = useStoreSearchMatch();
  const visibleCategories = useMemo(
    () =>
      categories
        .map((c) => ({ ...c, items: c.items.filter((i) => matchesSearch(itemSearchText({ name: i.name, description: i.description }, c.category))) }))
        .filter((c) => c.items.length > 0),
    [categories, matchesSearch],
  );

  // Stock learned from an out_of_stock rejection, until the refreshed props land.
  const [stockOverride, setStockOverride] = useState<Record<string, number>>({});
  useEffect(() => setStockOverride({}), [categories]);

  /** Stock of one cart line: the size's when it has one, else the item's. */
  function stockFor(item: MenuOrderItem, size: StoreSize | null): StorefrontStock | null {
    const key = cartLineKey(item.id, size?.id);
    return withStockOverride(size ? size.stock : (item.stock ?? null), stockOverride[key]);
  }
  /** Stepper ceiling: the line cap, or less when stock is tracked. */
  function maxFor(item: MenuOrderItem, size: StoreSize | null): number {
    return maxOrderableQty(stockFor(item, size)?.maxQty ?? null, null);
  }

  // Saved per store; items no longer on the (available + online) menu are
  // dropped on restore, and tracked items are cut down to the stock left.
  const { cart, setCart, clearCart } = usePersistedCart({
    storageKey: cartStorageKey(slug, { kind: "menu" }),
    accepting: true,
    maxFor: (key) => {
      const line = resolveKey(key);
      return line ? maxFor(line.item, line.size) : null;
    },
  });

  // A refresh can bring less stock (or a sold-out item) than the cart holds.
  useEffect(() => {
    setCart((c) => {
      const next = restoreCartLines(c, (key) => {
        const line = resolveKey(key);
        if (!line) return null;
        return maxOrderableQty((line.size ? line.size.stock : line.item.stock)?.maxQty ?? null, null);
      });
      return sameCartLines(next, c) ? c : next;
    });
  }, [resolveKey, setCart]);

  /** `key`: a cart line key (`cartLineKey`). */
  function setQty(key: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[key];
      else next[key] = qty;
      return next;
    });
  }

  // Drop cart lines whose item (or size) vanished after a refresh (made unavailable).
  const lines = toMenuOrderLines(cart).flatMap((l) => {
    const line = resolveKey(cartLineKey(l.menuItemId, l.variantId));
    if (!line) return [];
    const priceInPaise = line.size?.priceInPaise ?? line.item.priceInPaise;
    const name = line.size ? variantLineName(line.item.name, line.size.label) : line.item.name;
    return [{ ...line, qty: l.qty, priceInPaise, name }];
  });
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const offered = applyOffers(
    lines.map((l) => ({ key: l.key, menuItemId: l.item.id, priceInPaise: l.priceInPaise, qty: l.qty })),
    offers,
  );
  const appliedOffer = offered.applied;
  // What the cart bars show: items less the offer discount (delivery is added at checkout).
  const payablePaise = offered.totalPaise;
  const canPay = payment.upi || payment.cod;

  // The page-level cart bar (CartHub) shows this cart next to any drop's.
  const inHub = useCartHubEntry({
    key: "menu",
    label: "Everyday items",
    itemCount,
    subtotalPaise: payablePaise,
    canPay,
    note: offerCartNoteText(offered),
    onCheckout: () => setOpen(true),
    enabled: true,
  });

  function onRejected(err: OrderApiError): string {
    const item = err.menuItemId ? byId.get(err.menuItemId) : undefined;
    const size = err.variantId ? item?.sizes?.find((v) => v.id === err.variantId) : undefined;
    const message = orderErrorMessage(err, item && size ? variantLineName(item.name, size.label) : item?.name);
    if (err.error === "out_of_stock" && err.menuItemId) {
      const key = cartLineKey(err.menuItemId, err.variantId);
      const left = Math.max(0, err.remaining ?? 0);
      setStockOverride((o) => ({ ...o, [key]: left }));
      setCart((c) => cartAfterStockRejection(c, key, left));
      router.refresh();
    } else if (err.error === "item_not_found" && err.menuItemId) {
      const key = cartLineKey(err.menuItemId, err.variantId);
      setCart((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      });
      router.refresh();
    } else if (err.error === "size_required" && err.menuItemId) {
      // The seller added sizes after this cart was built: the plain line can't be placed.
      const key = err.menuItemId;
      setCart((c) => {
        const next = { ...c };
        delete next[key];
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

  // Price (sale-aware, lib/offers.ts), unit, stock and the Popular badge: the same line in both layouts.
  const priceLine = (item: MenuOrderItem, priceInPaise: number, stock: StorefrontStock | null) => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <ItemPrice priceInPaise={priceInPaise} sale={salePriceFor(offers, item.id, priceInPaise)} unit={item.unit} />
      {stockBadgeText(stock) ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
            stock?.soldOut ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {stockBadgeText(stock)}
        </span>
      ) : null}
      {item.isPopular ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Popular
        </span>
      ) : null}
    </span>
  );

  // The header already says "Pickup" and the plain delivery fee; areas carry their own fees.
  const areaSummary = fulfilmentTypes.includes("DELIVERY") ? deliveryAreaSummary(deliveryAreas, deliveryFeePaise) : null;
  const details = [
    areaSummary ? { key: "areas", icon: Truck, text: areaSummary } : null,
    fulfilmentTypes.includes("PICKUP") && pickupNote ? { key: "pickup", icon: MapPin, text: `Pickup: ${pickupNote}` } : null,
    nextSlotLabel ? { key: "slot", icon: CalendarClock, text: `Next slot: ${nextSlotLabel}` } : null,
  ].filter((d) => d !== null);

  return (
    <div id="menu-order" className="scroll-mt-16">
      {/* Only what the header's "Pickup · Free delivery · Pay …" line can't say: where, which areas, when. */}
      {details.length > 0 ? (
        <ul
          aria-label="Pickup and delivery"
          className="mb-4 space-y-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground"
        >
          {details.map(({ key, icon: Icon, text }) => (
            <li key={key} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <OfferChips offers={offers} />

      <div className="space-y-8">
        {visibleCategories.map(({ category, anchor, items }) => (
          <section key={anchor} aria-labelledby={anchor}>
            <div className="mb-3 flex items-baseline gap-3">
              <h3 id={anchor} className="scroll-mt-20 font-display text-base font-bold text-awaaz-charcoal">
                {category}
              </h3>
              <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
            </div>
            <ul
              className={
                layout === "gallery"
                  ? "grid grid-cols-2 gap-3 sm:grid-cols-3"
                  : "divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xs"
              }
            >
              {items.map((item) => {
                const size = sizeFor(item);
                const key = cartLineKey(item.id, size?.id);
                const stock = stockFor(item, size);
                // An item with sizes is dimmed only when none can be bought; one sold-out size just has no stepper.
                const itemSoldOut = item.sizes ? allSizesSoldOut(item.sizes) : (stock?.soldOut ?? false);
                const soldOut = itemSoldOut || (stock?.soldOut ?? false);
                const shownPrice = size?.priceInPaise ?? item.priceInPaise;
                const range = item.sizes ? variantPriceRange(item.priceInPaise, item.sizes) : null;
                // Sold out: no stepper, like a sold-out pre-order item; the badge says why.
                const stepper = soldOut ? null : (
                  <QtyStepper
                    itemName={size ? variantLineName(item.name, size.label) : item.name}
                    qty={cart[key] ?? 0}
                    max={maxFor(item, size)}
                    onChange={(q) => setQty(key, q)}
                  />
                );
                const sizes =
                  item.sizes && item.sizes.length > 0 && !itemSoldOut ? (
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
                  ) : null;
                return layout === "gallery" ? (
                  <li
                    key={item.id}
                    id={menuItemAnchor(item.id)}
                    className="flex scroll-mt-20 flex-col gap-2 rounded-2xl border border-border/60 bg-background p-2.5 shadow-xs target:bg-primary/8"
                  >
                    <ItemPhoto
                      src={item.imageUrl}
                      emoji={item.emoji}
                      name={item.name}
                      size="tile"
                      enlarge
                      dimmed={itemSoldOut}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
                        {item.name}
                      </span>
                      {item.description ? (
                        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.description}</span>
                      ) : null}
                      {priceLine(item, shownPrice, itemSoldOut ? { soldOut: true, onlyLeft: null, maxQty: 0 } : stock)}
                    </span>
                    {sizes}
                    {stepper}
                  </li>
                ) : (
                  <li
                    key={item.id}
                    id={menuItemAnchor(item.id)}
                    className="flex scroll-mt-20 items-center gap-3 px-3 py-3 target:bg-primary/8 sm:gap-4 sm:px-4"
                  >
                    <ItemPhoto src={item.imageUrl} emoji={item.emoji} name={item.name} size="row" dimmed={itemSoldOut} />

                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
                        {item.name}
                      </span>
                      {item.description ? (
                        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.description}</span>
                      ) : null}
                      {priceLine(item, shownPrice, itemSoldOut ? { soldOut: true, onlyLeft: null, maxQty: 0 } : stock)}
                      {sizes}
                    </span>

                    {stepper}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {!canPay ? <NoPaymentNotice /> : null}

      <OfferCartNote offered={offered} inCartBar={inHub} />

      {inHub ? null : (
        <CartBar
          itemCount={itemCount}
          subtotalPaise={payablePaise}
          canPay={canPay}
          onCheckout={() => setOpen(true)}
          buttonRef={checkoutRef}
        />
      )}

      <CheckoutSheet
        theme={theme}
        notesExample={notesExample}
        open={open}
        onOpenChange={onSheetOpenChange}
        slug={slug}
        endpoint={`/api/s/${encodeURIComponent(slug)}/menu-orders`}
        idPrefix="menu"
        description={vendorName}
        storeName={vendorName}
        lines={lines.map((l) => ({
          id: l.key,
          name: l.name,
          priceInPaise: l.priceInPaise,
          qty: l.qty,
          max: maxFor(l.item, l.size),
        }))}
        onChangeQty={setQty}
        discount={appliedOffer}
        gift={offered.gift}
        setAsideNote={offerSetAsideText(offered)}
        fulfilmentTypes={fulfilmentTypes}
        deliveryFeePaise={deliveryFeePaise}
        deliveryAreas={deliveryAreas}
        pickupNote={pickupNote}
        slotRules={slotRules}
        payment={payment}
        whatsapp={whatsapp}
        prefill={prefill}
        returnFocusRef={inHub ? undefined : checkoutRef}
        onOrdered={clearCart}
        buildBody={(d) => ({
          items: lines.map((l) => ({ menuItemId: l.item.id, ...(l.size ? { variantId: l.size.id } : {}), qty: l.qty })),
          ...d,
        })}
        onRejected={onRejected}
      />
    </div>
  );
}
