import type { FulfilmentMode } from "@prisma/client";
import type { Metadata } from "next";
import {
  ArrowUp,
  BadgeCheck,
  CalendarClock,
  Instagram,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  QrCode,
  ShoppingBag,
  Store,
  Sparkles,
  Truck,
  UserRound,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CartHubProvider } from "@/components/storefront/CartHub";
import { DropOrder, type BuyerPrefill, type DropOrderItem } from "@/components/storefront/DropOrder";
import { MenuOrder, type MenuOrderCategory } from "@/components/storefront/MenuOrder";
import { RecentOrderLink } from "@/components/storefront/RecentOrderLink";
import { ShareStoreButton } from "@/components/storefront/ShareStoreButton";
import { StoreBackButton } from "@/components/storefront/StoreBackButton";
import { StorePageRefresh } from "@/components/storefront/StorePageRefresh";
import {
  HideWhileSearching,
  Searchable,
  StoreSearchBar,
  StoreSearchEmpty,
  StoreSearchProvider,
} from "@/components/storefront/StoreSearch";
import { UpiPayOptions } from "@/components/storefront/UpiPayOptions";
import { UpiQrImage } from "@/components/storefront/UpiQrImage";
import { EmptyState } from "@/components/ui/empty-state";
import { getIstTodayStart } from "@/lib/billing-period";
import { formatINRCompact } from "@/lib/currency";
import { foodImageFor } from "@/lib/food-images";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { displayStoreName } from "@/lib/demo-store-schema";
import { allowedFulfilmentTypes, effectiveDropStatus, remainingQty, soldQtyByDropItem } from "@/lib/drops";
import { formatDropDayLabel, formatFulfilmentWindow } from "@/lib/drops-time";
import { instagramProfileUrl } from "@/lib/instagram";
import { everydayMenuHiddenByDrop } from "@/lib/menu-orders";
import { offersForItems, resolveOffers, type ResolvedOffer } from "@/lib/offers";
import { loadOfferRules, type OfferSource } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";
import {
  buyerWhatsappNumber,
  dropHasStock,
  formatIstDeadline,
  formatTimeLeft,
  menuItemAnchor,
  STOREFRONT_MENU_ITEM_WHERE,
  storefrontDropVisibility,
  storeWhatsappNumber,
  whatsappChatLink,
  type StorefrontDropVisibility,
} from "@/lib/storefront-order";
import { qrSvgDataUrl } from "@/lib/qr";
import { stallTypeLabel } from "@/lib/stall-type";
import { storeInfoFacts, type StoreFactKind } from "@/lib/store-info";
import { viewerIsStoreStaff } from "@/lib/storefront-viewer";
import { buildUpiCollectLink } from "@/lib/upi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public storefront — the only unauthenticated page that reads tenant data.
 *
 * Three rules hold this route together:
 *
 *   1. Opt-in only. `VendorSettings.publishStorefront` defaults to false, so a
 *      menu and its prices go public exactly when the vendor says so.
 *   2. A vendor who has not opted in is indistinguishable from one who does not
 *      exist — both 404. Same reasoning as the cross-tenant 404 rule in
 *      lib/rbac.ts: a 403 here would confirm the stall is on AwaazOS.
 *   3. The `select` is an allowlist, never a spread. `Vendor.phone` and
 *      `Vendor.email` are contact PII and must not reach a public page;
 *      `upiId` is here only because collecting payment is the point.
 *      Off VendorSettings, besides the publish gate itself, only: `theme`
 *      (brand colour), `fssaiNumber` (food-safety licence, legally meant to be
 *      displayed), `acceptPayOnDelivery` (whether to offer that option), and
 *      the "Order from menu" switches: `acceptMenuOrders`, `menuFulfilmentMode`,
 *      `menuDeliveryFeePaise`, `menuPickupNote` (rendered at checkout).
 *
 * Drops (daily pre-order menus) render above the regular menu. Only stored-OPEN
 * drops from yesterday (IST) onward are read; the cut-off is evaluated here on
 * every request (`effectiveDropStatus`), never by a timer — hence force-dynamic,
 * and stock counts are recomputed per render. The order write path is
 * app/api/s/[slug]/orders, held to the same gate.
 *
 * "Order from menu" (`acceptMenuOrders`): the everyday menu becomes orderable
 * (MenuOrder: steppers, cart, checkout) via app/api/s/[slug]/menu-orders, held
 * to the same gate. Off, the menu stays read-only with the generic UPI QR.
 *
 * Everyday menu visibility: only `isAvailable && showOnline` items are read
 * (`showOnline = false` keeps an item on the counter POS only). While a drop is
 * taking orders with `showEverydayMenu = false`, the whole everyday menu —
 * rows, category pills, "Order now", the menu cart — is left out and only the
 * drop(s) show (`everydayMenuHiddenByDrop` in lib/menu-orders.ts — the same check
 * placeMenuOrder uses to refuse with `menu_paused_for_drop`).
 *
 * The open-amount "Scan to pay" QR shows only with a read-only menu. With a
 * cart (menu ordering) or a drop holding the page, checkout gives the buyer an
 * exact UPI amount and no second, open-amount QR is shown.
 *
 * Offers (lib/offers.ts): each orderable section gets the offers live on it,
 * resolved on the server to the item ids that section already shows plus the
 * offer's name, description and numbers. Raw tags and the rest of the Offer row
 * stay on the server; the browser only previews, the order routes price.
 *
 * Optional buyer sign-in (lib/customer-auth.ts): the `awz_cust` session, when
 * present, only adds a header link and checkout prefill from the buyer's OWN
 * Customer row. It never widens the vendor `select` above. Guests see the
 * page exactly as before, plus a "Sign in" link. Signing out lives on the
 * account page only, so the pill row fits a 360 px phone.
 *
 * `RecentOrderLink` (client, device-local) adds "Your recent order" to that
 * pill row for a buyer who ordered from this device; nothing about it is read
 * or rendered on the server. `StoreBackButton` adds Back when the tab has
 * history.
 *
 * Staff viewing their own store (lib/storefront-viewer.ts): a signed-in
 * AwaazOS user who is active staff of this vendor gets "Dashboard" (→ /home)
 * in place of the buyer pill. Only a boolean comes back; nothing else about
 * the user reaches the page.
 *
 * Header order: name → type · place → "About this store" facts (handover for
 * the everyday menu, payment, FSSAI licence; lib/store-info.ts) → contact
 * links → one call to action. The sticky bar under it starts with "Top".
 */

type StorefrontVendor = NonNullable<Awaited<ReturnType<typeof loadStorefront>>>;

/**
 * Top padding that drops the logo (64 px, 88 px from `sm`) so it straddles the
 * banner's bottom edge: banner height (160 / 224 px) − pill row above (56 px)
 * − half the logo.
 */
const BANNER_LOGO_OFFSET = "pt-[72px] sm:pt-[124px]";

/** Header contact pills (WhatsApp chat, Instagram profile). */
const CONTACT_LINK =
  "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-4 text-sm font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

/** Header pill-row pills (Back, Share, Sign in / My orders / Dashboard). */
const PILL =
  "inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

const FACT_ICON: Record<StoreFactKind, typeof Store> = {
  pickup: Store,
  delivery: Truck,
  payment: Wallet,
  fssai: BadgeCheck,
};

/** Themes with a `[data-theme=…]` block in globals.css; anything else stays saffron. */
const BRAND_THEMES = new Set(["green", "amber", "red", "blue", "purple"]);

/**
 * Deduped across generateMetadata() and the page render — React `cache` keeps
 * this to a single query per request.
 */
const loadStorefront = cache(async (slug: string) => {
  const yesterday = new Date(getIstTodayStart().getTime() - 24 * 60 * 60 * 1000);
  return prisma.vendor.findFirst({
    where: {
      slug,
      isActive: true,
      settings: { is: { publishStorefront: true } },
    },
    select: {
      id: true, // tenant key for server-side checks only; never rendered
      slug: true,
      name: true,
      isDemo: true,
      city: true,
      state: true,
      stallType: true,
      stallTypeOther: true, // the seller's own words for "Other"; shown as the store type
      logoUrl: true,
      bannerUrl: true,
      upiId: true,
      upiName: true,
      settings: {
        select: {
          theme: true,
          fssaiNumber: true,
          acceptPayOnDelivery: true,
          acceptMenuOrders: true,
          whatsappNumber: true, // rendered only through storeWhatsappNumber(); else a boolean
          acceptWhatsappOrders: true,
          showWhatsappOnStore: true,
          instagramHandle: true,
          menuFulfilmentMode: true,
          menuDeliveryFeePaise: true,
          menuPickupNote: true,
        },
      },
      drops: {
        where: { status: "OPEN", date: { gte: yesterday } },
        orderBy: [{ date: "asc" }, { closesAt: "asc" }],
        take: 10,
        select: {
          id: true,
          title: true,
          note: true,
          date: true,
          status: true,
          opensAt: true,
          closesAt: true,
          fulfilmentMode: true,
          fulfilmentStartsAt: true,
          fulfilmentEndsAt: true,
          pickupNote: true,
          deliveryFeePaise: true,
          showEverydayMenu: true,
          items: {
            orderBy: [{ sortOrder: "asc" }],
            select: {
              id: true,
              priceInPaise: true,
              maxQty: true,
              perOrderLimit: true,
              menuItemId: true,
              menuItem: { select: { name: true, emoji: true, imageUrl: true } },
            },
          },
        },
      },
      menuItems: {
        where: STOREFRONT_MENU_ITEM_WHERE,
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          emoji: true,
          category: true,
          priceInPaise: true,
          unit: true,
          isPopular: true,
          imageUrl: true,
        },
      },
    },
  });
});

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const vendor = await loadStorefront(params.slug);
  if (!vendor) return { title: "Not found — AwaazOS" };

  const place = [vendor.city, vendor.state].filter(Boolean).join(", ");
  const title = `${displayStoreName(vendor)} — Online store`;
  const where = place ? `${vendor.name}, ${place}` : vendor.name;
  const menuHidden = await everydayMenuHiddenByDrop(prisma, vendor.id);
  const ordering = !menuHidden && (vendor.settings?.acceptMenuOrders ?? false) && vendor.menuItems.length > 0;
  const description = menuHidden
    ? `Pre-order today's special from ${where}. Pay by UPI.`
    : ordering
      ? `Order online from ${where}. ${menuFulfilmentPhrase(vendor.settings?.menuFulfilmentMode ?? "PICKUP")}, pay by UPI.`
      : `Items and prices for ${where}. Pay by UPI.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    // Demo stores (lib/demo-store.ts) stay out of search results.
    ...(vendor.isDemo ? { robots: { index: false, follow: false } } : {}),
  };
}

/** "Pickup" / "Delivery" / "Pickup or delivery" — mirrors the OG card's line. */
function menuFulfilmentPhrase(mode: FulfilmentMode): string {
  return mode === "BOTH" ? "Pickup or delivery" : mode === "DELIVERY" ? "Delivery" : "Pickup";
}


type StorefrontItems = StorefrontVendor["menuItems"];

/** Preserves the query ordering; no re-sort. */
function groupByCategory(items: StorefrontItems): [string, StorefrontItems][] {
  const groups = new Map<string, StorefrontItems>();
  for (const item of items) {
    const bucket = groups.get(item.category);
    if (bucket) bucket.push(item);
    else groups.set(item.category, [item]);
  }
  return Array.from(groups.entries());
}

/** What the search bar matches for an everyday-menu row: name and category. */
function menuItemSearchText(item: { name: string }, category: string): string {
  return `${item.name} ${category}`;
}

/** A drop row: its name and the drop's title ("Saturday bakes"). */
function dropItemSearchText(item: { name: string }, dropTitle: string): string {
  return `${item.name} ${dropTitle}`;
}

/** Category names are vendor-authored free text; anchors must survive spaces and `&`. */
function categoryAnchor(category: string, index: number): string {
  const slug = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cat-${slug || "items"}-${index}`;
}

function MenuRow({ item }: { item: StorefrontItems[number] }) {
  return (
    <li className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-primary/4 sm:gap-4 sm:px-4">
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt=""
          width={72}
          height={72}
          className="h-18 w-18 shrink-0 rounded-xl object-cover ring-1 ring-border/60"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-18 w-18 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-3xl"
        >
          {item.emoji}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-snug text-foreground">
          {item.name}
        </span>
        {item.isPopular ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Popular
          </span>
        ) : null}
      </span>

      <span className="shrink-0 rounded-lg bg-muted/70 px-2.5 py-1 font-mono text-sm font-bold tabular-nums text-foreground">
        {formatINRCompact(item.priceInPaise)}
      </span>
    </li>
  );
}

type StorefrontDrop = StorefrontVendor["drops"][number];

type DropView = {
  drop: StorefrontDrop;
  visibility: Exclude<StorefrontDropVisibility, "hidden">;
  items: DropOrderItem[];
  /** Open, but every item is sold out — nothing left to pre-order. */
  soldOut: boolean;
  /** Offers a buyer can earn on this drop right now. */
  offers: ResolvedOffer[];
};

/**
 * Effective status + live stock per drop. Sold counts are queried only for
 * orderable drops; `soldQtyByDropItem` filters by dropId, and every drop here
 * already came through the vendor-scoped, publish-gated query above.
 *
 * `menuAnchorFor` returns the everyday-menu row id for items the buyer can
 * order there too (null when menu ordering is off), so a sold-out pre-order
 * item can point at it.
 */
async function buildDropViews(
  drops: StorefrontDrop[],
  now: Date,
  menuAnchorFor: (menuItemId: string) => string | null,
  offerSource: OfferSource,
): Promise<DropView[]> {
  const visible = drops
    .map((drop) => ({
      drop,
      visibility: storefrontDropVisibility(effectiveDropStatus(drop, now), drop.closesAt, now),
    }))
    .filter(
      (d): d is { drop: StorefrontDrop; visibility: DropView["visibility"] } => d.visibility !== "hidden",
    );

  return Promise.all(
    visible.map(async ({ drop, visibility }) => {
      const sold =
        visibility === "open" ? await soldQtyByDropItem(prisma, drop.id, now) : new Map<string, number>();
      const items: DropOrderItem[] = drop.items.map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.menuItem.name,
        emoji: i.menuItem.emoji,
        // The seller's photo, else a drawing of the dish (lib/food-images.ts), else the emoji.
        imageUrl: i.menuItem.imageUrl ?? foodImageFor(i.menuItem.name),
        priceInPaise: i.priceInPaise,
        remaining: remainingQty(i.maxQty, sold.get(i.id) ?? 0),
        perOrderLimit: i.perOrderLimit,
        menuAnchor: menuAnchorFor(i.menuItemId),
      }));
      const soldOut = visibility === "open" && !dropHasStock(items);
      const offers =
        visibility === "open" && !soldOut
          ? offersForItems(
              resolveOffers(offerSource.rules, offerSource.menuItems, { channel: "DROP", dropId: drop.id, now }),
              drop.items.map((i) => i.menuItemId),
            )
          : [];
      return { drop, visibility, items, soldOut, offers };
    }),
  );
}

function DropSection({
  view,
  slug,
  payment,
  whatsapp,
  now,
  prefill,
  menuOrdering,
}: {
  view: DropView;
  slug: string;
  payment: { upi: boolean; cod: boolean };
  whatsapp: boolean;
  now: Date;
  prefill: BuyerPrefill | null;
  /** Everyday menu is orderable — a sold-out drop points buyers at it. */
  menuOrdering: boolean;
}) {
  const { drop, visibility, soldOut } = view;
  const headingId = `drop-${drop.id}`;
  const types = allowedFulfilmentTypes(drop.fulfilmentMode);
  const orderable = visibility === "open" && !soldOut;
  const timeLeft = orderable ? formatTimeLeft(drop.closesAt, now) : null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-3xl border border-primary/25 bg-linear-to-b from-primary/8 to-background px-3 py-4 shadow-xs sm:p-5"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-primary">
        Pre-order · {formatDropDayLabel(drop.date)}
      </p>
      <h3 id={headingId} className="mt-1 font-display text-2xl font-bold leading-tight text-awaaz-charcoal">
        {drop.title}
      </h3>
      {drop.note ? <p className="mt-1 text-sm text-muted-foreground">{drop.note}</p> : null}

      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            {types.includes("DELIVERY") && types.includes("PICKUP")
              ? "Delivery or pickup"
              : types.includes("DELIVERY")
                ? "Delivery"
                : "Pickup"}{" "}
            · {formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt)}
          </span>
        </li>
        {types.includes("DELIVERY") ? (
          <li className="flex items-start gap-2">
            <Truck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              {drop.deliveryFeePaise > 0
                ? `Delivery fee ${formatINRCompact(drop.deliveryFeePaise)}`
                : "Free delivery"}
            </span>
          </li>
        ) : null}
        {types.includes("PICKUP") && drop.pickupNote ? (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>Pickup: {drop.pickupNote}</span>
          </li>
        ) : null}
      </ul>

      <p
        className={
          orderable
            ? "mt-3 inline-flex flex-wrap items-center gap-x-2 rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground"
            : "mt-3 inline-flex rounded-full bg-muted px-3 py-1 text-sm font-bold text-muted-foreground"
        }
      >
        {soldOut ? (
          "Sold out"
        ) : orderable ? (
          <>
            <span>Order by {formatIstDeadline(drop.closesAt, now)}</span>
            {timeLeft ? <span className="font-semibold opacity-90">· {timeLeft}</span> : null}
          </>
        ) : visibility === "scheduled" && drop.opensAt ? (
          `Orders open ${formatIstDeadline(drop.opensAt, now)}`
        ) : (
          "Orders closed"
        )}
      </p>

      {soldOut ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Everything in this batch has been ordered.
          {menuOrdering ? (
            <>
              {" "}
              <a
                href="#menu-order"
                className="font-semibold text-primary underline underline-offset-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Order from everyday items
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4">
        <DropOrder
          slug={slug}
          dropId={drop.id}
          dropTitle={drop.title}
          items={view.items}
          orderable={orderable}
          fulfilmentTypes={types}
          deliveryFeePaise={drop.deliveryFeePaise}
          pickupNote={drop.pickupNote}
          pickupWindow={formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt)}
          payment={payment}
          whatsapp={whatsapp}
          prefill={prefill}
          offers={view.offers}
        />
      </div>
    </section>
  );
}

export default async function StorefrontPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const vendor = await loadStorefront(params.slug);
  if (!vendor) notFound();

  const now = new Date();
  // An open drop with showEverydayMenu=false takes over the page: no menu rows,
  // pills, counts, "Order now" or menu cart — exactly as if the menu were empty.
  // Same server check placeMenuOrder uses, so the page and checkout always agree.
  const menuHidden = await everydayMenuHiddenByDrop(prisma, vendor.id, now);
  // Items without a photo get a drawing of the dish when one matches
  // (lib/food-images.ts); display only, nothing is stored.
  const menuItems = (menuHidden ? [] : vendor.menuItems).map((item) => ({
    ...item,
    imageUrl: item.imageUrl ?? foodImageFor(item.name, item.category),
  }));
  const categories = groupByCategory(menuItems);
  const popular = menuItems.filter((i) => i.isPopular).slice(0, 6);
  const payeeName = vendor.upiName ?? vendor.name;
  const upiLink = vendor.upiId
    ? buildUpiCollectLink({ upiId: vendor.upiId, name: payeeName })
    : null;
  const place = [vendor.city, vendor.state].filter(Boolean).join(", ");
  const rawTheme = vendor.settings?.theme ?? "orange";
  const theme = BRAND_THEMES.has(rawTheme) ? rawTheme : undefined;

  const menuOrdering = (vendor.settings?.acceptMenuOrders ?? false) && categories.length > 0;
  // The open-amount "Scan to pay" QR, only for a read-only menu (see #pay below).
  // Rendered here, not by a third-party image URL: no network hop for the buyer,
  // and the payee VPA never leaves our server.
  const qrLarge = upiLink && !menuOrdering && !menuHidden ? await qrSvgDataUrl(upiLink, 220) : "";
  // Everyday-menu rows only take orders (and carry row ids) with menu ordering on.
  const orderableMenuIds = new Set(menuOrdering ? menuItems.map((i) => i.id) : []);
  // One read covers both channels; a store with nothing orderable skips it.
  const offerSource: OfferSource =
    menuOrdering || vendor.drops.length > 0
      ? await loadOfferRules(prisma, vendor.id, ["MENU", "DROP"])
      : { rules: [], menuItems: [] };
  const menuOffers = menuOrdering
    ? offersForItems(
        resolveOffers(offerSource.rules, offerSource.menuItems, { channel: "MENU", now }),
        orderableMenuIds,
      )
    : [];
  const [dropViews, customer, isStaff] = await Promise.all([
    buildDropViews(
      vendor.drops,
      now,
      (id) => (orderableMenuIds.has(id) ? menuItemAnchor(id) : null),
      offerSource,
    ),
    getCurrentCustomer(),
    viewerIsStoreStaff(vendor.id),
  ]);
  const prefill: BuyerPrefill | null = customer
    ? { name: customer.name, phone: customer.phone, address: customer.savedAddress }
    : null;
  // The drop a buyer has least time left to order from drives the header CTA.
  const nextClosing = dropViews
    .filter((d) => d.visibility === "open" && !d.soldOut)
    .reduce<Date | null>((min, d) => (!min || d.drop.closesAt < min ? d.drop.closesAt : min), null);
  const payment = {
    upi: !!vendor.upiId,
    cod: vendor.settings?.acceptPayOnDelivery ?? false,
  };
  // Opted in with a usable number → checkout also offers "Also send my order to the store on WhatsApp". Only the boolean reaches the client.
  const whatsapp = buyerWhatsappNumber(vendor.settings) !== null;
  // Header contact links. WhatsApp has its own opt-in (every visitor sees it, not only buyers).
  const storeWhatsapp = storeWhatsappNumber(vendor.settings);
  const whatsappLink = storeWhatsapp
    ? whatsappChatLink(storeWhatsapp, `Hi ${vendor.name}, I saw your store and have a question.`)
    : null;
  const facts = storeInfoFacts({
    menuOrdering,
    fulfilmentMode: vendor.settings?.menuFulfilmentMode ?? "PICKUP",
    deliveryFeePaise: vendor.settings?.menuDeliveryFeePaise ?? 0,
    hasDrops: dropViews.length > 0,
    upi: payment.upi,
    cod: payment.cod,
    fssaiNumber: vendor.settings?.fssaiNumber ?? null,
  });
  const instagramHandle = vendor.settings?.instagramHandle ?? null;
  const instagramLink = instagramProfileUrl(instagramHandle);
  // Everything the search bar can find: one text per row, as the rows match it.
  const searchIndex = [
    ...dropViews.flatMap((view) => view.items.map((item) => dropItemSearchText(item, view.drop.title))),
    ...categories.flatMap(([category, items]) => items.map((item) => menuItemSearchText(item, category))),
  ];
  const menuCategories: MenuOrderCategory[] = categories.map(([category, items], i) => ({
    category,
    anchor: categoryAnchor(category, i),
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      imageUrl: item.imageUrl,
      priceInPaise: item.priceInPaise,
      unit: item.unit,
      isPopular: item.isPopular,
    })),
  }));

  return (
    <div id="store-top" data-theme={theme} className="min-h-screen bg-awaaz-cream/40">
      <StorePageRefresh />
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to items
      </a>

      {vendor.isDemo ? (
        <p className="relative z-10 bg-awaaz-charcoal px-4 py-2 text-center text-xs font-medium text-white">
          This is a demo store. Orders placed here are samples and no payment is taken.
        </p>
      ) : null}

      {/* Brand band. The vendor's theme colour is the only thing that differs
          between one storefront and the next, so it carries the whole identity. */}
      <header className="relative overflow-hidden border-b border-border/50 bg-linear-to-b from-primary/20 via-primary/[0.07] to-background">
        {vendor.bannerUrl ? (
          // Decorative cover photo. BANNER_LOGO_OFFSET below is derived from these heights.
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 sm:h-56">
            <Image src={vendor.bannerUrl} alt="" fill priority sizes="100vw" className="object-cover" />
            {/* Darkens the top edge so the Share / Sign in pills read on any photo. */}
            <div className="absolute inset-0 bg-linear-to-b from-black/30 via-transparent to-transparent" />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage: "radial-gradient(hsl(var(--primary)) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
              maskImage: "linear-gradient(to bottom, black, transparent 70%)",
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)",
            }}
          />
        )}

        <div className="relative mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 pt-3 sm:px-6">
          {/* Back and the recent-order pill appear after mount, left of the
              right-aligned pills: nothing else moves. */}
          <StoreBackButton />
          <RecentOrderLink slug={vendor.slug} />
          <ShareStoreButton vendorName={vendor.name} slug={vendor.slug} />
          {isStaff ? (
            // The seller (or their staff) looking at their own store: they are
            // signed in to AwaazOS, not as a buyer, so offer the way back in.
            <Link href="/home" className={PILL}>
              <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Dashboard</span>
            </Link>
          ) : (
            <Link href={`/s/${vendor.slug}/account`} className={PILL}>
              <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {customer ? `Hi${customer.name ? `, ${customer.name.split(/\s+/)[0]}` : ""} · My orders` : "Sign in"}
              </span>
            </Link>
          )}
        </div>

        <div
          className={`relative mx-auto max-w-2xl px-4 pb-7 sm:px-6 sm:pb-9 ${
            vendor.bannerUrl ? BANNER_LOGO_OFFSET : "pt-4 sm:pt-8"
          }`}
        >
          <div className="flex flex-col items-center text-center">
            {vendor.logoUrl ? (
              <Image
                src={vendor.logoUrl}
                alt=""
                width={88}
                height={88}
                className="h-16 w-16 shrink-0 rounded-2xl bg-background object-cover shadow-lg ring-4 ring-background sm:h-[88px] sm:w-[88px]"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary font-display text-3xl font-bold text-primary-foreground shadow-lg ring-4 ring-background sm:h-[88px] sm:w-[88px] sm:text-4xl"
              >
                {vendor.name.slice(0, 1).toUpperCase()}
              </div>
            )}

            <h1 className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight text-awaaz-charcoal sm:text-4xl sm:leading-10">
              {displayStoreName(vendor)}
            </h1>

            {/* What and where, as one quiet line under the name. */}
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <UtensilsCrossed className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {stallTypeLabel(vendor.stallType, vendor.stallTypeOther)}
              </span>
              {place ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {place}
                </span>
              ) : null}
            </p>

            {/* How the store works: handover, payment, licence (lib/store-info.ts). */}
            {facts.length > 0 ? (
              <ul
                aria-label="About this store"
                className="mt-4 flex max-w-md flex-wrap items-center justify-center gap-2"
              >
                {facts.map((fact) => {
                  const Icon = FACT_ICON[fact.kind];
                  return (
                    <li
                      key={fact.kind}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      {fact.text}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {whatsappLink || instagramLink ? (
              <ul aria-label="Contact" className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {whatsappLink ? (
                  <li>
                    <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>
                      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      WhatsApp
                    </a>
                  </li>
                ) : null}
                {instagramLink ? (
                  <li className="min-w-0">
                    <a href={instagramLink} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>
                      <Instagram className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="sr-only">Instagram: </span>
                      <span className="truncate">@{instagramHandle}</span>
                    </a>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {nextClosing ? (
              <a
                href="#drops"
                className="mt-5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-primary px-6 py-2 text-left text-sm font-bold text-primary-foreground shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
                Pre-order · closes {formatIstDeadline(nextClosing, now)}
              </a>
            ) : menuOrdering ? (
              // With no drop above it the menu starts right under this header,
              // so a jump link would go nowhere; the cart bar is the next step.
              dropViews.length > 0 ? (
                <a
                  href="#menu-order"
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  Order now
                </a>
              ) : null
            ) : upiLink && !menuHidden ? (
              <a
                href="#pay"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Scan &amp; pay
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <StoreSearchProvider index={searchIndex}>
        {/* Category jump bar — a long mela menu on a phone is unusable without it.
            Its search button swaps the pills for a search field (StoreSearch). */}
        {categories.length + dropViews.length > 0 ? (
          <nav
            aria-label="Categories"
            className="sticky top-0 z-20 border-b border-border/50 bg-background/85 backdrop-blur-sm supports-backdrop-filter:bg-background/70"
          >
            <StoreSearchBar>
              <ul className="flex gap-2 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
                {/* "Home": back to the store's header from anywhere down the menu. */}
                <li className="shrink-0">
                  <a
                    href="#store-top"
                    aria-label={`Back to the top of ${vendor.name}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 px-3 text-sm font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Top</span>
                  </a>
                </li>
                {dropViews.length > 0 ? (
                  <li className="shrink-0">
                    <a
                      href="#drops"
                      className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/10 px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      Pre-order
                    </a>
                  </li>
                ) : null}
                {categories.map(([category], i) => (
                  <li key={category} className="shrink-0">
                    <a
                      href={`#${categoryAnchor(category, i)}`}
                      className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-border/70 px-4 text-sm font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {category}
                    </a>
                  </li>
                ))}
              </ul>
            </StoreSearchBar>
          </nav>
        ) : null}

        <CartHubProvider>
          <main id="menu" className="mx-auto max-w-2xl px-4 py-7 sm:px-6 sm:py-9">
            {dropViews.length > 0 ? (
              <div id="drops" className="mb-10 scroll-mt-20 space-y-6">
                <h2 className="sr-only">Pre-orders</h2>
                {dropViews.map((view) => (
                  <Searchable
                    key={view.drop.id}
                    texts={view.items.map((item) => dropItemSearchText(item, view.drop.title))}
                  >
                    <DropSection
                      view={view}
                      slug={vendor.slug}
                      payment={payment}
                      whatsapp={whatsapp}
                      now={now}
                      prefill={prefill}
                      menuOrdering={menuOrdering}
                    />
                  </Searchable>
                ))}
              </div>
            ) : null}

            {dropViews.length > 0 && categories.length > 0 ? (
              <h2 className="mb-4 font-display text-lg font-bold text-awaaz-charcoal">Everyday items</h2>
            ) : dropViews.length === 0 ? (
              <h2 className="sr-only">Items</h2>
            ) : null}

            {categories.length === 0 ? (
              dropViews.length > 0 ? null : (
                <EmptyState
                  className="rounded-2xl bg-background px-4 py-12"
                  description="This store has not published any items yet. Please check back soon."
                />
              )
            ) : (
              <div className="space-y-8">
                {/* With menu ordering on, rows carry their own "Popular" badge and a
                    stepper; a second, non-orderable grid would only confuse. */}
                {popular.length > 1 && !menuOrdering ? (
                  <HideWhileSearching>
                    <section aria-labelledby="popular-heading">
                      <h3
                        id="popular-heading"
                        className="mb-3 flex items-center gap-2 font-display text-base font-bold text-awaaz-charcoal"
                      >
                        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                        Most loved
                      </h3>
                      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {popular.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-col gap-2 rounded-2xl border border-primary/20 bg-linear-to-b from-primary/10 to-background p-3 shadow-xs"
                          >
                            {item.imageUrl ? (
                              <Image
                                src={item.imageUrl}
                                alt=""
                                width={44}
                                height={44}
                                className="h-11 w-11 rounded-xl object-cover ring-1 ring-border/60"
                              />
                            ) : (
                              <span aria-hidden="true" className="text-2xl leading-none">
                                {item.emoji}
                              </span>
                            )}
                            <span className="text-sm font-semibold leading-snug text-foreground">
                              {item.name}
                            </span>
                            <span className="mt-auto font-mono text-sm font-bold tabular-nums text-primary">
                              {formatINRCompact(item.priceInPaise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </HideWhileSearching>
                ) : null}

                {menuOrdering ? (
                  <MenuOrder
                    slug={vendor.slug}
                    vendorName={vendor.name}
                    categories={menuCategories}
                    fulfilmentTypes={allowedFulfilmentTypes(vendor.settings?.menuFulfilmentMode ?? "PICKUP")}
                    deliveryFeePaise={vendor.settings?.menuDeliveryFeePaise ?? 0}
                    pickupNote={vendor.settings?.menuPickupNote ?? null}
                    payment={payment}
                    whatsapp={whatsapp}
                    prefill={prefill}
                    offers={menuOffers}
                  />
                ) : null}

                {menuOrdering ? null : categories.map(([category, items], i) => (
                  <Searchable key={category} texts={items.map((item) => menuItemSearchText(item, category))}>
                    <section aria-labelledby={categoryAnchor(category, i)}>
                      <div className="mb-3 flex items-baseline gap-3">
                        <h3
                          id={categoryAnchor(category, i)}
                          className="scroll-mt-20 font-display text-base font-bold text-awaaz-charcoal"
                        >
                          {category}
                        </h3>
                        <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
                        <span className="text-xs font-semibold text-muted-foreground">
                          {items.length}
                        </span>
                      </div>
                      <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xs">
                        {items.map((item) => (
                          <Searchable key={item.id} texts={[menuItemSearchText(item, category)]}>
                            <MenuRow item={item} />
                          </Searchable>
                        ))}
                      </ul>
                    </section>
                  </Searchable>
                ))}
              </div>
            )}

            <StoreSearchEmpty />

            {upiLink && !menuOrdering && !menuHidden ? (
              <section
                id="pay"
                aria-labelledby="pay-heading"
                className="mt-10 scroll-mt-16 overflow-hidden rounded-2xl border border-primary/25 bg-background shadow-xs"
              >
                <div className="bg-linear-to-b from-primary/10 to-transparent px-4 py-6 text-center sm:px-6">
                  <h3 id="pay-heading" className="font-display text-xl font-bold text-awaaz-charcoal">
                    Scan to pay
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Any UPI app. Enter the amount the seller tells you.
                  </p>

                  <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3 shadow-md ring-1 ring-border/60">
                    <UpiQrImage src={qrLarge} alt={`UPI QR code to pay ${payeeName}`} size={220} sample={vendor.isDemo} />
                  </div>

                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Paying {payeeName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Scan from another phone, or open your UPI app below.</p>
                  {vendor.upiId ? (
                    <UpiPayOptions
                      upiLink={upiLink}
                      upiId={vendor.upiId}
                      genericLabel="Open UPI app"
                      linksMobileOnly
                      className="mt-4"
                    />
                  ) : null}
                </div>
              </section>
            ) : null}
          </main>

          <footer className="px-4 pb-10 pt-2 text-center">
            <Link
              href="/"
              className="group inline-flex min-h-11 items-center rounded-full"
            >
              {/* The link is the 44px tap target; the pill inside keeps its size. */}
              <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                Billing by AwaazOS — Bol. Bill. Becho.
              </span>
            </Link>
          </footer>
        </CartHubProvider>
      </StoreSearchProvider>
    </div>
  );
}
