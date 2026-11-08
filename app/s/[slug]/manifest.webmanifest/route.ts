import { NextResponse } from "next/server";

import { displayStoreName } from "@/lib/demo-store-schema";
import { storeAppManifest } from "@/lib/store-app";
import { loadStoreApp } from "@/lib/store-app-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The store's own web app manifest (lib/store-app.ts), linked from every page
 * under /s/[slug] by its layout. Same gate as the store page: an unknown store
 * and one that hasn't published are both 404.
 *
 * Browsers fetch it when a page loads and again now and then to update an
 * installed app, so it is cacheable for a few minutes; a renamed store or a new
 * colour reaches the app on its next update.
 */
export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const store = await loadStoreApp(slug);
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const manifest = storeAppManifest({
    slug: store.slug,
    name: displayStoreName(store),
    theme: store.settings?.theme,
  });
  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
