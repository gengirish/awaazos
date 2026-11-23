import { productShareCard } from "./product-card";

/**
 * GET /s/<slug>/p/<itemId>/share-card[?v=…] — one product's link-preview PNG.
 * `v` is only a cache key for crawlers (lib/share-card.ts) and is ignored.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await ctx.params;
  return productShareCard(slug, itemId);
}
