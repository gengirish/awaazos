import type { Metadata } from "next";

import { StorefrontView, storefrontMetadata } from "./storefront-view";

/**
 * Public storefront, /s/<slug>. The page itself lives in ./storefront-view.tsx
 * (read its header): /s/<slug>/p/<itemId> renders the same page with one
 * item's detail sheet open.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  return storefrontMetadata(slug);
}

export default async function StorefrontPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  const { slug } = await props.params;
  return <StorefrontView slug={slug} searchParams={props.searchParams} />;
}
