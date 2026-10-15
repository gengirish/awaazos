import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";

import { STORY_SIZE } from "@/lib/drop-story-image";
import { conflict, dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { requireVendorRole } from "@/lib/rbac";
import { loadStoreStory, StoreStoryCard } from "@/lib/store-story-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/vendor/story-image — 1080×1920 PNG of the store's everyday menu for
 * an Instagram story. Fetched only when the seller taps "Instagram story";
 * never cached (prices change). 409 `store_not_published` when /s/[slug] would
 * 404, and `no_menu_items` when the storefront shows no items to put on it.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const story = await loadStoreStory(ctx.vendor.id);
    if (!story) throw notFound();
    if (!story.published) throw conflict("store_not_published");
    if (story.items.length === 0) throw conflict("no_menu_items");

    const image = new ImageResponse(<StoreStoryCard story={story} host={req.nextUrl.host} />, STORY_SIZE);
    const res = new NextResponse(image.body, { status: image.status, headers: image.headers });
    res.headers.set("Cache-Control", "private, no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "vendor/story-image");
  }
}
