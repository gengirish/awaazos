import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

import { formatINR } from "@/lib/currency";
import { effectiveDropStatus } from "@/lib/drops";
import { formatFulfilmentWindow, formatIstDayLabel, formatIstTime } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { everydayMenuHiddenByDrops, STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";

/**
 * Link-preview card for /s/<slug> — what WhatsApp shows when a vendor shares
 * today's menu.
 *
 * Same gate as the storefront page: vendor exists, is active and has opted in
 * via `publishStorefront`. Anything else gets a generic AwaazOS card (an image
 * URL shouldn't 404, but it must not confirm the stall exists either — the
 * generic card carries nothing derived from the slug).
 *
 * Variants, in priority order: an open (or scheduled) drop with its items and
 * cut-off; else, with "Order from menu" on, up to four menu items offered
 * online (`isAvailable && showOnline`, popular first) and "Order online ·
 * Pickup/Delivery"; else "See the menu". The menu variant is never used while
 * an open drop hides the everyday menu (`everydayMenuHiddenByDrops`, same rule
 * as the page) — that drop is the card.
 *
 * The Prisma `select` is a hand-written allowlist: never `phone` / `email`.
 *
 * Satori only supports inline styles, so this file is the one place in the UI
 * that uses them; colours are literal because CSS variables don't exist here.
 * Default bundled font only (Latin). The ₹ glyph isn't in it and would trigger
 * a Google Fonts fetch, so it is drawn as an inline SVG instead.
 *
 * Rendered only when a crawler fetches a shared link — event-driven, no timer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Today's menu on AwaazOS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MAX_ITEMS = 4;

const C = {
  primary: "#FF6B00",
  ink: "#1A1A1A",
  muted: "#475569",
  surface: "#FFFFFF",
  tint: "#FFF4EC",
};

async function loadCard(slug: string, now: Date) {
  const vendor = await prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: {
      id: true,
      name: true,
      city: true,
      // "Order from menu" variant: only what the card draws.
      settings: { select: { acceptMenuOrders: true, menuFulfilmentMode: true } },
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
        },
      },
    },
  });
  if (!vendor) return null;

  const live = vendor.drops.filter((d) => effectiveDropStatus(d, now) === "OPEN");
  const upcoming = vendor.drops.filter((d) => effectiveDropStatus(d, now) === "SCHEDULED");
  const drop = live[0] ?? upcoming[0] ?? null; // already sorted by closesAt
  const menuHidden = everydayMenuHiddenByDrops(vendor.drops, now);
  const menuOrdering =
    !drop && !menuHidden && (vendor.settings?.acceptMenuOrders ?? false) && vendor.menuItems.length > 0
      ? { mode: vendor.settings?.menuFulfilmentMode ?? "PICKUP", items: vendor.menuItems }
      : null;
  return { name: vendor.name, city: vendor.city, drop, menuOrdering };
}

function RupeeGlyph({ size: px }: { size: number }) {
  return (
    <svg width={px * 0.62} height={px} viewBox="0 0 20 32" style={{ marginRight: px * 0.06 }}>
      <path
        d="M3 5 H18 M3 12 H18 M3 5 H8 C13 5 15 8 15 11.5 C15 15 12 18 8 18 H4 L15 29"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** formatINR output with the ₹ drawn as SVG. */
function Price({ paise, fontSize }: { paise: number; fontSize: number }) {
  const digits = formatINR(paise).replace("₹", "").trim();
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize }}>
      <RupeeGlyph size={fontSize * 0.8} />
      <span>{digits}</span>
    </div>
  );
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
      <span>AwaazOS · Bol. Bill. Becho.</span>
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

function ItemRows({ items }: { items: { name: string; priceInPaise: number }[] }) {
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
            borderBottom: "1px solid #E2E8F0",
          }}
        >
          <span>{truncate(it.name, 40)}</span>
          <Price paise={it.priceInPaise} fontSize={34} />
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function GenericCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>Order on AwaazOS</div>
        <div style={{ display: "flex", fontSize: 36, color: C.muted, marginTop: 16 }}>
          Fresh menus from local kitchens and stalls
        </div>
      </div>
      <Brand />
    </Frame>
  );
}

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const now = new Date();
  let card: Awaited<ReturnType<typeof loadCard>> = null;
  try {
    card = await loadCard(params.slug, now);
  } catch (err) {
    // A preview image must never 500 — fall back to the generic card.
    console.error("[og] storefront card load failed", err instanceof Error ? err.message : "unknown");
  }

  if (!card) return new ImageResponse(<GenericCard />, size);

  const { drop, menuOrdering } = card;
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: "flex", flexDirection: "column" }}>
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
              {menuOrdering ? "Order from the menu" : "See the menu"}
            </div>
          )}
        </div>

        {drop ? (
          <ItemRows items={drop.items.map((it) => ({ name: it.menuItem.name, priceInPaise: it.priceInPaise }))} />
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
                {`Order by ${formatIstDayLabel(drop.closesAt)}, ${formatIstTime(drop.closesAt)}`}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 10 }}>
                {`${drop.fulfilmentMode === "PICKUP" ? "Pickup" : drop.fulfilmentMode === "BOTH" ? "Delivery or pickup" : "Delivery"} ${formatFulfilmentWindow(drop.fulfilmentStartsAt, drop.fulfilmentEndsAt)}`}
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
    size,
  );
}
