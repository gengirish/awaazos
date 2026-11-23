import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

import { effectiveDropStatus } from "@/lib/drops";
import { formatFulfilmentWindow, formatIstDayLabel, formatIstTime } from "@/lib/drops-time";
import { fulfilmentModeLabel, OG_COLORS as C, Price, storeLogoDataUrl, truncate } from "@/lib/og-parts";
import { prisma } from "@/lib/prisma";
import { everydayMenuHiddenByDrops, STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { SHARE_CARD_CACHE_CONTROL, SHARE_CARD_SIZE as size } from "@/lib/share-card";

/**
 * Link-preview card for /s/<slug> — what WhatsApp shows when a vendor shares
 * today's menu.
 *
 * Same gate as the storefront page: vendor exists, is active and has opted in
 * via `publishStorefront`. Anything else gets a generic AwaazOS card (an image
 * URL shouldn't 404, but it must not confirm the stall exists either — the
 * generic card carries nothing derived from the slug).
 *
 * The store logo (`Vendor.logoUrl`) sits top-right when it loads in time, and the
 * tagline (`VendorSettings.tagline`) goes under the headline of the menu and
 * browse variants.
 *
 * Variants, in priority order: an open (or scheduled) drop with its items and
 * cut-off; else, with "Order from menu" on, up to four menu items offered
 * online (`isAvailable && showOnline`, popular first) and "Order online ·
 * Pickup/Delivery"; else "See the menu". The menu variant is never used while
 * an open drop hides the everyday menu (`everydayMenuHiddenByDrops`, same rule
 * as the page) — that drop is the card. A drop shows its first four items and
 * "+N more". A pre-order link (/s/<slug>/preorder/<dropId>) draws its own drop
 * with the same layout (`renderShareCard`), never the store's first one, and as
 * photo tiles when at least one of its first items has a photo that loaded
 * (`ItemTiles`; an item without one gets a tile with its initial). This card
 * passes no photos, so it keeps the text rows.
 *
 * The Prisma `select` is a hand-written allowlist: never `phone` / `email`.
 *
 * Satori only supports inline styles; the shared colours, ₹ glyph and price
 * row live in lib/og-parts.tsx (also used by the Instagram story image).
 *
 * Served by ./route.tsx at /s/<slug>/share-card (why not opengraph-image.tsx:
 * lib/share-card.ts). Rendered only when a crawler fetches a shared link —
 * event-driven, no timer.
 */

const RESPONSE = { ...size, headers: { "Cache-Control": SHARE_CARD_CACHE_CONTROL } };

/** Item rows a card draws; more than this reads "+N more". */
export const SHARE_CARD_MAX_ITEMS = 4;
const MAX_ITEMS = SHARE_CARD_MAX_ITEMS;

/** The drop a card draws: the store's first open one, or one pre-order link's drop. */
export type ShareCardDrop = {
  title: string;
  closesAt: Date;
  fulfilmentMode: string;
  fulfilmentStartsAt: Date;
  fulfilmentEndsAt: Date;
  /**
   * The first SHARE_CARD_MAX_ITEMS, in the drop's order. `photo` is a loaded
   * PNG/JPEG data URL (`storeLogoDataUrl`), set only by the pre-order card.
   */
  items: { priceInPaise: number; menuItem: { name: string }; photo?: string | null }[];
  /** All of the drop's items, for "+N more". */
  itemCount: number;
  /** Past its cut-off (a pre-order link within the closed grace window). */
  closed: boolean;
};

export type ShareCardData = {
  name: string;
  city: string | null;
  tagline: string | null;
  logo: string | null;
  drop: ShareCardDrop | null;
  menuOrdering: { mode: string; items: { name: string; priceInPaise: number }[] } | null;
};

async function loadCard(slug: string, now: Date): Promise<ShareCardData | null> {
  const vendor = await prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: {
      id: true,
      name: true,
      city: true,
      logoUrl: true,
      // "Order from menu" variant: only what the card draws.
      settings: { select: { acceptMenuOrders: true, menuFulfilmentMode: true, tagline: true } },
      menuItems: {
        where: STOREFRONT_MENU_ITEM_WHERE,
        orderBy: [{ isPopular: "desc" }, { category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        take: MAX_ITEMS,
        select: { name: true, priceInPaise: true },
      },
      drops: {
        // Coarse DB filter; the precise rule is effectiveDropStatus below.
        where: { status: "OPEN", closesAt: { gt: now } },
        orderBy: { closesAt: "asc" },
        take: 10,
        select: {
          title: true,
          status: true,
          opensAt: true,
          closesAt: true,
          fulfilmentMode: true,
          fulfilmentStartsAt: true,
          fulfilmentEndsAt: true,
          showEverydayMenu: true,
          items: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            take: MAX_ITEMS,
            select: { priceInPaise: true, menuItem: { select: { name: true } } },
          },
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!vendor) return null;

  const live = vendor.drops.filter((d) => effectiveDropStatus(d, now) === "OPEN");
  const upcoming = vendor.drops.filter((d) => effectiveDropStatus(d, now) === "SCHEDULED");
  const first = live[0] ?? upcoming[0] ?? null; // already sorted by closesAt
  const drop: ShareCardDrop | null = first ? { ...first, itemCount: first._count.items, closed: false } : null;
  const menuHidden = everydayMenuHiddenByDrops(vendor.drops, now);
  const menuOrdering =
    !drop && !menuHidden && (vendor.settings?.acceptMenuOrders ?? false) && vendor.menuItems.length > 0
      ? { mode: vendor.settings?.menuFulfilmentMode ?? "PICKUP", items: vendor.menuItems }
      : null;
  return {
    name: vendor.name,
    city: vendor.city,
    tagline: vendor.settings?.tagline ?? null,
    logo: await storeLogoDataUrl(vendor.logoUrl),
    drop,
    menuOrdering,
  };
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: C.muted }}>
      <div
        style={{
          display: "flex",
          width: 18,
          height: 18,
          borderRadius: 9,
          background: C.primary,
          marginRight: 12,
        }}
      />
      <span>{`${BRAND_NAME} · ${BRAND_TAGLINE}`}</span>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.surface,
        borderTop: `16px solid ${C.primary}`,
        padding: "56px 72px",
        color: C.ink,
        fontFamily: "sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function menuOrderLine(mode: string): string {
  const how = mode === "BOTH" ? "Pickup or delivery" : mode === "DELIVERY" ? "Delivery" : "Pickup";
  return `Order online · ${how}`;
}

function ItemRows({ items, more = 0 }: { items: { name: string; priceInPaise: number }[]; more?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 34,
            padding: "8px 0",
            borderBottom: `1px solid ${C.rule}`,
          }}
        >
          <span>{truncate(it.name, 40)}</span>
          <Price paise={it.priceInPaise} fontSize={34} />
        </div>
      ))}
      {more > 0 ? (
        <div style={{ display: "flex", fontSize: 26, color: C.muted, paddingTop: 8 }}>{`+${more} more`}</div>
      ) : null}
    </div>
  );
}

/** Photo tile size: four across the card's 1056 px content width. */
const TILE_W = 246;
const TILE_PHOTO_H = 132;

/** A drop's items as photo tiles: photo, name, price. Same "+N more" as ItemRows. */
function ItemTiles({
  items,
  more,
}: {
  items: { name: string; priceInPaise: number; photo: string | null }[];
  more: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex" }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", width: TILE_W, marginRight: i < items.length - 1 ? 24 : 0 }}>
            {it.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- Satori draws a plain <img>
              <img
                src={it.photo}
                alt=""
                width={TILE_W}
                height={TILE_PHOTO_H}
                style={{ width: TILE_W, height: TILE_PHOTO_H, borderRadius: 16, objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: TILE_W,
                  height: TILE_PHOTO_H,
                  borderRadius: 16,
                  background: C.tint,
                  color: C.muted,
                  fontSize: 64,
                  fontWeight: 700,
                }}
              >
                {(it.name.trim()[0] ?? "").toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", fontSize: 26, marginTop: 8 }}>{truncate(it.name, 16)}</div>
            <div style={{ display: "flex", marginTop: 2 }}>
              <Price paise={it.priceInPaise} fontSize={28} />
            </div>
          </div>
        ))}
      </div>
      {more > 0 ? (
        <div style={{ display: "flex", fontSize: 26, color: C.muted, paddingTop: 6 }}>{`+${more} more`}</div>
      ) : null}
    </div>
  );
}

function GenericCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>{`Order on ${BRAND_NAME}`}</div>
        <div style={{ display: "flex", fontSize: 36, color: C.muted, marginTop: 16 }}>
          Order online from local stores
        </div>
      </div>
      <Brand />
    </Frame>
  );
}

export async function storeShareCard(slug: string): Promise<Response> {
  const now = new Date();
  let card: ShareCardData | null = null;
  try {
    card = await loadCard(slug, now);
  } catch (err) {
    // A preview image must never 500 — fall back to the generic card.
    console.error("[og] storefront card load failed", err instanceof Error ? err.message : "unknown");
  }
  return renderShareCard(card);
}

/**
 * Draws a card; null is the generic one. Shared with the pre-order link's card
 * (app/s/[slug]/preorder/[dropId]/share-card), which passes one drop and no menu.
 */
export function renderShareCard(card: ShareCardData | null): Response {
  if (!card) return new ImageResponse(<GenericCard />, RESPONSE);

  const { drop, menuOrdering } = card;
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 30, color: C.primary, fontWeight: 700 }}>
              {truncate(card.name, 48)}
              {card.city ? ` · ${truncate(card.city, 24)}` : ""}
            </div>
            {drop ? (
              <div style={{ display: "flex", fontSize: 64, fontWeight: 700, marginTop: 8 }}>
                {truncate(drop.title, 36)}
              </div>
            ) : (
              <div style={{ display: "flex", fontSize: 64, fontWeight: 700, marginTop: 8 }}>
                {menuOrdering ? "Order now" : "Browse the store"}
              </div>
            )}
            {card.tagline && !drop ? (
              <div style={{ display: "flex", fontSize: 30, color: C.muted, marginTop: 8 }}>
                {truncate(card.tagline, 64)}
              </div>
            ) : null}
          </div>
          {card.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws a plain <img>
            <img
              src={card.logo}
              alt=""
              width={128}
              height={128}
              style={{ width: 128, height: 128, borderRadius: 24, objectFit: "cover", marginLeft: 32 }}
            />
          ) : null}
        </div>

        {drop && drop.items.some((it) => it.photo) ? (
          <ItemTiles
            items={drop.items.map((it) => ({
              name: it.menuItem.name,
              priceInPaise: it.priceInPaise,
              photo: it.photo ?? null,
            }))}
            more={drop.itemCount - drop.items.length}
          />
        ) : drop ? (
          <ItemRows
            items={drop.items.map((it) => ({ name: it.menuItem.name, priceInPaise: it.priceInPaise }))}
            more={drop.itemCount - drop.items.length}
          />
        ) : menuOrdering ? (
          <ItemRows items={menuOrdering.items} />
        ) : (
          <div style={{ display: "flex" }} />
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          {drop ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 30,
                  fontWeight: 700,
                  color: C.ink,
                  background: C.tint,
                  borderRadius: 12,
                  padding: "8px 16px",
                }}
              >
                {drop.closed
                  ? "Orders closed"
                  : `Order by ${formatIstDayLabel(drop.closesAt)}, ${formatIstTime(drop.closesAt)}`}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 10 }}>
                {`${fulfilmentModeLabel(drop.fulfilmentMode)} ${formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt)}`}
              </div>
            </div>
          ) : menuOrdering ? (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: C.ink,
                background: C.tint,
                borderRadius: 12,
                padding: "8px 16px",
              }}
            >
              {menuOrderLine(menuOrdering.mode)}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <Brand />
        </div>
      </Frame>
    ),
    RESPONSE,
  );
}
