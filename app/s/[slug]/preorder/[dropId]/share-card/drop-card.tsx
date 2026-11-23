import { renderShareCard, SHARE_CARD_MAX_ITEMS, storeShareCard, type ShareCardData } from "@/app/s/[slug]/share-card/store-card";
import { getIstTodayStart } from "@/lib/billing-period";
import { storeLogoDataUrl } from "@/lib/og-parts";
import { prisma } from "@/lib/prisma";
import { findFocusedDrop, focusedDropVisibility, isPlausibleDropId } from "@/lib/storefront-drop";

/**
 * Link-preview card for a pre-order link, /s/<slug>/preorder/<dropId>
 * (docs/DROP_LINK_PLAN.md): that drop's title, first items with prices,
 * cut-off and handover window — never another drop and never the everyday menu.
 *
 * Same gates as the page: the store is active and published, and the drop is one
 * the page would show (`findFocusedDrop`, read with the slug's vendor, the same
 * stored-OPEN-from-yesterday filter as `loadStorefront`). A store that isn't
 * published gets the generic card; a drop that doesn't show (draft, closed for
 * good, another store's id) gets the store's own card, as the page shows the store.
 *
 * The Prisma `select` is a hand-written allowlist: never `phone` / `email`.
 */

async function loadDropCard(slug: string, dropId: string, now: Date): Promise<ShareCardData | "store" | null> {
  const yesterday = new Date(getIstTodayStart(now).getTime() - 24 * 60 * 60 * 1000);
  const vendor = await prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: {
      name: true,
      city: true,
      logoUrl: true,
      settings: { select: { tagline: true } },
      drops: {
        where: { id: dropId, status: "OPEN", date: { gte: yesterday } },
        take: 1,
        select: {
          id: true,
          title: true,
          status: true,
          opensAt: true,
          closesAt: true,
          fulfilmentMode: true,
          fulfilmentStartsAt: true,
          fulfilmentEndsAt: true,
          items: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            take: SHARE_CARD_MAX_ITEMS,
            select: { priceInPaise: true, menuItem: { select: { name: true } } },
          },
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!vendor) return null;
  const drop = findFocusedDrop(vendor.drops, dropId, now);
  if (!drop) return "store";
  return {
    name: vendor.name,
    city: vendor.city,
    tagline: vendor.settings?.tagline ?? null,
    logo: await storeLogoDataUrl(vendor.logoUrl),
    drop: {
      ...drop,
      itemCount: drop._count.items,
      closed: focusedDropVisibility(drop, now) === "closed",
    },
    menuOrdering: null,
  };
}

export async function dropShareCard(slug: string, dropId: string): Promise<Response> {
  if (!isPlausibleDropId(dropId)) return storeShareCard(slug);
  let card: ShareCardData | "store" | null = null;
  try {
    card = await loadDropCard(slug, dropId, new Date());
  } catch (err) {
    // A preview image must never 500 — fall back to the generic card.
    console.error("[og] pre-order card load failed", err instanceof Error ? err.message : "unknown");
  }
  if (card === "store") return storeShareCard(slug);
  return renderShareCard(card);
}
