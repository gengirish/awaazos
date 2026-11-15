import { NextRequest, NextResponse } from "next/server";

import { deleteBlobQuietly } from "@/lib/blob-image";
import { withVendorCookie } from "@/lib/drops-api";
import { requireEnv } from "@/lib/env";
import { removePhoto } from "@/lib/item-photos";
import { changeItemPhotos } from "@/lib/item-photos-server";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/menu/[id]/images/[imageId] → { data: PhotoRef[] } 200
 *
 * Removes one photo (`imageId` is a photo row id, or `cover`); removing the
 * cover moves the next photo up (lib/item-photos.ts rule 3), then the blob is
 * deleted. Another store's item, or an id not among the item's photos → 404.
 */
const TAG = "api/menu images DELETE";

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string; imageId: string }> }) {
  const { id, imageId } = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    // Resolved before the write, so a missing token fails cleanly instead of
    // clearing the row and orphaning the blob.
    let token: string;
    try {
      token = requireEnv("BLOB_READ_WRITE_TOKEN");
    } catch {
      return NextResponse.json({ error: "photo_uploads_unavailable" }, { status: 503 });
    }

    const changed = await changeItemPhotos(ctx.vendor.id, id, (photos) => {
      const urls = removePhoto(photos, imageId);
      return urls ? { urls, result: photos.find((p) => p.id === imageId)!.url } : { refuse: null };
    });
    if (!changed || !changed.written) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await deleteBlobQuietly(changed.outcome, token, TAG);
    return withVendorCookie(NextResponse.json({ data: changed.photos }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(`[${TAG}]`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
