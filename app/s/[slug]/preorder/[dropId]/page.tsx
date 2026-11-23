import type { Metadata } from "next";

import { loadStorefront, StorefrontView, storefrontMetadata } from "@/app/s/[slug]/storefront-view";
import { displayStoreName } from "@/lib/demo-store-schema";
import { formatShareItemList, preorderLinkPath } from "@/lib/drops-share";
import { formatIstDayLabel, formatIstTime } from "@/lib/drops-time";
import { dropShareCardPath, shareCardMetadata, shareCardVersion } from "@/lib/share-card";
import { findFocusedDrop, focusedDropVisibility } from "@/lib/storefront-drop";

/**
 * A pre-order link, /s/<slug>/preorder/<dropId> (docs/DROP_LINK_PLAN.md): the
 * store page showing that drop only, with a link preview of that drop's items.
 * What "Share this pre-order" sends.
 *
 * Never a 404 for a published store: a drop the page wouldn't list (draft,
 * closed for good, another store's id) renders the whole store with a notice
 * (lib/storefront-drop.ts). An unpublished or unknown store 404s like /s/<slug>.
 * `noindex`: the page expires with the drop; search engines get the store page.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = Promise<{ slug: string; dropId: string }>;

export async function generateMetadata(props: { params: Params }): Promise<Metadata> {
  const { slug, dropId } = await props.params;
  // Same cached read as the page render: no extra query.
  const vendor = await loadStorefront(slug);
  const now = new Date();
  const drop = vendor ? findFocusedDrop(vendor.drops, dropId, now) : null;
  if (!vendor || !drop) {
    const store = await storefrontMetadata(slug);
    return { ...store, robots: { index: false, follow: !vendor?.isDemo } };
  }

  const closed = focusedDropVisibility(drop, now) === "closed";
  const storeName = displayStoreName(vendor);
  const title = `${drop.title} · ${storeName}`;
  const when = closed ? "Orders closed" : `Order by ${formatIstDayLabel(drop.closesAt)}, ${formatIstTime(drop.closesAt)}`;
  const items = formatShareItemList(drop.items.map((i) => i.menuItem.name));
  const description = items ? `${when} · ${items}` : when;
  // The version covers everything share-card/drop-card.tsx draws (lib/share-card.ts).
  const version = shareCardVersion({
    name: vendor.name,
    city: vendor.city,
    logo: vendor.logoUrl,
    title: drop.title,
    closed,
    closesAt: drop.closesAt,
    mode: drop.fulfilmentMode,
    window: [drop.fulfilmentStartsAt, drop.fulfilmentEndsAt],
    items: drop.items.map((i) => [i.menuItem.name, i.priceInPaise, i.menuItem.imageUrl]),
  });
  return {
    title,
    description,
    alternates: { canonical: preorderLinkPath(vendor.slug, drop.id) },
    ...shareCardMetadata(dropShareCardPath(vendor.slug, drop.id, version), { title, description }),
    // Demo stores stay out of search results entirely (lib/demo-store.ts).
    robots: { index: false, follow: !vendor.isDemo },
  };
}

export default async function PreorderPage(props: {
  params: Params;
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  const { slug, dropId } = await props.params;
  return <StorefrontView slug={slug} searchParams={props.searchParams} focusDropId={dropId} />;
}
