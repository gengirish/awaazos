import type { Metadata } from "next";

import { StorefrontView, storefrontMetadata } from "@/app/s/[slug]/storefront-view";
import { formatINRCompact } from "@/lib/currency";
import { displayStoreName } from "@/lib/demo-store-schema";
import { loadStorefrontProduct } from "@/lib/storefront-product";

/**
 * A product link, /s/<slug>/p/<menuItemId> (docs/PRODUCT_PAGE_PLAN.md step 2):
 * the store page with that item's detail sheet open. Sellers post it on
 * Instagram for one product; the store's own layout (manifest, install) applies.
 *
 * The page never 404s for a published store: an item that isn't on sale, or an
 * id that isn't this store's, renders the store with a one-line notice
 * (`resolveOpenItem`). An unpublished or unknown store 404s like /s/<slug>.
 * The id is the item's, not `MenuItem.slug`, which changes when it is renamed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = Promise<{ slug: string; itemId: string }>;

export async function generateMetadata(props: { params: Params }): Promise<Metadata> {
  const { slug, itemId } = await props.params;
  const product = await loadStorefrontProduct(slug, itemId);
  if (!product) return storefrontMetadata(slug);

  const { store, item } = product;
  const storeName = displayStoreName({ name: store.name, isDemo: store.isDemo });
  const title = `${item.name} · ${storeName}`;
  const price = formatINRCompact(item.sale?.salePricePaise ?? item.priceInPaise);
  const description = item.description ?? store.tagline ?? `${price} · Order from ${store.name} online`;
  return {
    title,
    description,
    alternates: { canonical: `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(item.id)}` },
    openGraph: { title, description, type: "website" },
    ...(store.isDemo ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function ProductPage(props: {
  params: Params;
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  const { slug, itemId } = await props.params;
  return <StorefrontView slug={slug} searchParams={props.searchParams} openItemId={itemId} />;
}
