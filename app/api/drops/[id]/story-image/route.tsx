import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";

import { dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { DropStoryCard, loadDropStory, STORY_SIZE } from "@/lib/drop-story-image";
import { requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/drops/[id]/story-image — 1080×1920 PNG of the drop for an Instagram
 * story. Fetched only when the vendor taps "Instagram story"; never cached
 * (prices and cut-off change while a drop is being edited).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const story = await loadDropStory(params.id, ctx.vendor.id);
    if (!story) throw notFound();

    const image = new ImageResponse(<DropStoryCard story={story} host={req.nextUrl.host} />, STORY_SIZE);
    const res = new NextResponse(image.body, { status: image.status, headers: image.headers });
    res.headers.set("Cache-Control", "private, no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "drops/story-image");
  }
}
