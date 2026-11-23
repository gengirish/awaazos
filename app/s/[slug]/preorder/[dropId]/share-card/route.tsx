import { dropShareCard } from "./drop-card";

/**
 * GET /s/<slug>/preorder/<dropId>/share-card[?v=…] — a pre-order link's preview
 * PNG. `v` is only a cache key for crawlers (lib/share-card.ts) and is ignored:
 * the card is always the current one. Public, like the store.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; dropId: string }> }) {
  const { slug, dropId } = await ctx.params;
  return dropShareCard(slug, dropId);
}
