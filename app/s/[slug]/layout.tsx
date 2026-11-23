import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { displayStoreName } from "@/lib/demo-store-schema";
import { shareCardMetadata, storeShareCardPath } from "@/lib/share-card";
import { storeAppIconPath, storeManifestPath, storeThemeHex } from "@/lib/store-app";
import { loadStoreApp } from "@/lib/store-app-server";

/**
 * Every page under /s/[slug] (the store, the buyer's order page, the account
 * page) installs as the store's own app (lib/store-app.ts), not the seller app
 * the root layout links. This replaces the root's manifest link, the iPhone
 * Home Screen title and icon, and the browser bar colour.
 *
 * An unknown or unpublished store links no manifest at all (`null`), so its
 * 404 page can't be installed as AwaazOS either. Renders nothing itself.
 */

type Params = Promise<{ slug: string }>;

export async function generateMetadata(props: { params: Params }): Promise<Metadata> {
  const { slug } = await props.params;
  const store = await loadStoreApp(slug);
  if (!store) return { manifest: null, appleWebApp: { capable: false } };
  const name = displayStoreName(store);
  return {
    manifest: storeManifestPath(store.slug),
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    icons: { apple: storeAppIconPath(store.slug, 180) },
    // Default preview for pages below the store (order, account): the store card,
    // unversioned. The store and product pages set their own, versioned (lib/share-card.ts).
    ...shareCardMetadata(storeShareCardPath(store.slug), { title: name }),
  };
}

export async function generateViewport(props: { params: Params }): Promise<Viewport> {
  const { slug } = await props.params;
  const store = await loadStoreApp(slug);
  return store ? { themeColor: storeThemeHex(store.settings?.theme) } : {};
}

export default function StoreLayout({ children }: { children: ReactNode }) {
  return children;
}
