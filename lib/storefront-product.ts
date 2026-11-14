import { effectiveDropStatus } from "@/lib/drops";
import { resolveOffers, salePriceFor, type SalePrice } from "@/lib/offers";
import { loadOfferRules } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";
import { everydayMenuHiddenByDrops, STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";

/**
 * One product of a published store, for its product link's title, description
 * and preview image (`/s/<slug>/p/<menuItemId>`, docs/PRODUCT_PAGE_PLAN.md step 2).
 * The page itself renders the store and finds the row on its own (`resolveOpenItem`
 * in app/s/[slug]/storefront-view.tsx); this answers only "what would a link
 * preview say".
 *
 * Same gates as the store page: the store exists, is active and published. The
 * item counts only where the page would show it: an open pre-order selling it
 * (priced from the drop), else the everyday menu (`isAvailable && showOnline`)
 * unless an open pre-order hides that menu. Anything else is null, and callers
 * fall back to the store's own card, which says nothing about the id.
 *
 * The Prisma `select` is a hand-written allowlist: never the vendor's phone or
 * email, and never cost, stock counts or tags.
 */
export type StorefrontProduct = {
  store: { name: string; city: string | null; tagline: string | null; logoUrl: string | null; isDemo: boolean };
  item: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    emoji: string;
    unit: string | null;
    priceInPaise: number;
    /** A live sale on it (`salePriceFor`); plans never give a card price. */
    sale: SalePrice | null;
  };
};

export async function loadStorefrontProduct(
  slug: string,
  menuItemId: string,
  now: Date = new Date(),
): Promise<StorefrontProduct | null> {
  if (!menuItemId || menuItemId.length > 64) return null;
  const vendor = await prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: {
      id: true,
      name: true,
      city: true,
      logoUrl: true,
      isDemo: true,
      settings: { select: { tagline: true } },
      menuItems: {
        where: { ...STOREFRONT_MENU_ITEM_WHERE, id: menuItemId },
        take: 1,
        select: { id: true, name: true, description: true, imageUrl: true, emoji: true, unit: true, priceInPaise: true },
      },
      drops: {
        // Coarse DB filter; the precise rule is effectiveDropStatus below.
        where: { status: "OPEN", closesAt: { gt: now } },
        orderBy: { closesAt: "asc" },
        take: 10,
        select: {
          id: true,
          status: true,
          opensAt: true,
          closesAt: true,
          showEverydayMenu: true,
          items: {
            where: { menuItemId },
            take: 1,
            select: {
              priceInPaise: true,
              menuItem: {
                select: { id: true, name: true, description: true, imageUrl: true, emoji: true, unit: true },
              },
            },
          },
        },
      },
    },
  });
  if (!vendor) return null;

  const store = {
    name: vendor.name,
    city: vendor.city,
    tagline: vendor.settings?.tagline ?? null,
    logoUrl: vendor.logoUrl,
    isDemo: vendor.isDemo,
  };
  const inDrop = vendor.drops.find((d) => d.items.length > 0 && effectiveDropStatus(d, now) === "OPEN");
  const menuRow = everydayMenuHiddenByDrops(vendor.drops, now) ? undefined : vendor.menuItems[0];
  if (!inDrop && !menuRow) return null;

  const base = inDrop
    ? { ...inDrop.items[0]!.menuItem, priceInPaise: inDrop.items[0]!.priceInPaise }
    : menuRow!;
  const source = await loadOfferRules(prisma, vendor.id, [inDrop ? "DROP" : "MENU"]);
  const offers = resolveOffers(source.rules, source.menuItems, {
    channel: inDrop ? "DROP" : "MENU",
    dropId: inDrop?.id ?? null,
    now,
  });
  return { store, item: { ...base, sale: salePriceFor(offers, base.id, base.priceInPaise) } };
}
