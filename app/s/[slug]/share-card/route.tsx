import { storeShareCard } from "./store-card";

/**
 * GET /s/<slug>/share-card[?v=…] — the store's link-preview PNG. `v` is only a
 * cache key for crawlers (lib/share-card.ts) and is ignored: the card is always
 * the current one, so an older page copy never gets a 404. Public, like the store.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return storeShareCard(slug);
}
