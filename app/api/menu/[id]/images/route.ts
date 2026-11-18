import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

import { deleteBlobQuietly, ImageUploadError, readImageUpload } from "@/lib/blob-image";
import { withVendorCookie } from "@/lib/drops-api";
import { requireEnv } from "@/lib/env";
import { canAddPhoto, MAX_ITEM_PHOTOS } from "@/lib/item-photos";
import { changeItemPhotos, loadItemPhotos } from "@/lib/item-photos-server";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * An item's photos, cover first (rules in lib/item-photos.ts).
 *
 * GET                                     → { data: PhotoRef[] }        200
 * POST multipart/form-data, field `file`  → { data: PhotoRef[] }        201
 *      adds a photo at the end (the cover when there is none);
 *      409 `too_many_photos` at MAX_ITEM_PHOTOS. No Blob token → 503.
 *
 * Same role as the single-photo route (`/api/menu/[id]/image`, CASHIER: who
 * can edit an item). Another store's item → 404.
 */
const TAG = "api/menu images";

function tooMany() {
  return NextResponse.json({ error: "too_many_photos", max: MAX_ITEM_PHOTOS }, { status: 409 });
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const photos = await loadItemPhotos(ctx.vendor.id, id);
    if (!photos) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withVendorCookie(NextResponse.json({ data: photos }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/menu images GET]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendorId = ctx.vendor.id;

    // Validated before touching Blob storage: never pay for an upload we reject.
    const { file, ext } = await readImageUpload(req);

    // Ownership and room first, so a forged id or a full item uploads nothing.
    const before = await loadItemPhotos(vendorId, id);
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAddPhoto(before.length)) return tooMany();

    let token: string;
    try {
      token = requireEnv("BLOB_READ_WRITE_TOKEN");
    } catch {
      return NextResponse.json({ error: "photo_uploads_unavailable" }, { status: 503 });
    }
    const blob = await put(`menu/${vendorId}/${id}.${ext}`, file, {
      access: "public",
      token,
      contentType: file.type,
      addRandomSuffix: true,
    });

    // Counted again under the lock: two uploads at once can't make seven.
    const changed = await changeItemPhotos<"added" | "full">(vendorId, id, (photos) =>
      canAddPhoto(photos.length) ? { urls: [...photos.map((p) => p.url), blob.url], result: "added" } : { refuse: "full" },
    ).catch(async (e: unknown) => {
      await deleteBlobQuietly(blob.url, token, TAG);
      throw e;
    });
    if (!changed || !changed.written) {
      await deleteBlobQuietly(blob.url, token, TAG);
      return changed ? tooMany() : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return withVendorCookie(NextResponse.json({ data: changed.photos }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError || err instanceof ImageUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/menu images POST]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
