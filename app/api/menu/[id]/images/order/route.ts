import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withVendorCookie } from "@/lib/drops-api";
import { MAX_ITEM_PHOTOS, reorderPhotos } from "@/lib/item-photos";
import { changeItemPhotos } from "@/lib/item-photos-server";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/menu/[id]/images/order { order: string[] } → { data: PhotoRef[] } 200
 *
 * The item's photo ids in their new order (the cover is `cover`); the first
 * becomes the cover (lib/item-photos.ts rules 1 and 4). An order that doesn't
 * name every photo exactly once → 409 `photos_changed` with the current list,
 * so the form can show what is really there. Another store's item → 404.
 */
const bodySchema = z.object({ order: z.array(z.string().min(1).max(64)).min(1).max(MAX_ITEM_PHOTOS) });

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { order } = bodySchema.parse(await req.json());

    const changed = await changeItemPhotos(ctx.vendor.id, id, (photos) => {
      const urls = reorderPhotos(photos, order);
      return urls ? { urls, result: true } : { refuse: false };
    });
    if (!changed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!changed.written) {
      return NextResponse.json({ error: "photos_changed", data: changed.photos }, { status: 409 });
    }
    return withVendorCookie(NextResponse.json({ data: changed.photos }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    if (err instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.error("[api/menu images order PUT]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
