import { put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";

import { deleteBlobQuietly, ImageUploadError, readImageUpload } from "@/lib/blob-image";
import { withVendorCookie } from "@/lib/drops-api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

/**
 * Store banner and logo upload — the handlers behind
 * `/api/vendor/banner` and `/api/vendor/logo` (server-only).
 *
 * POST   multipart/form-data, field `file` → { data: { url } }   200
 * DELETE (no body)                        → { success: true }    200
 *
 * OWNER only, like the store name. The vendor comes from the session, so
 * there is no id in the URL to forge. Size/type rules: lib/blob-image.ts.
 * No Blob token configured → 503 (uploads are a feature-gated integration).
 */
export type StoreImageKind = "banner" | "logo";

const FIELD = { banner: "bannerUrl", logo: "logoUrl" } as const satisfies Record<StoreImageKind, string>;

const unavailable = () => NextResponse.json({ error: "Image uploads are not set up" }, { status: 503 });

function errorResponse(err: unknown, tag: string) {
  if (err instanceof AuthError || err instanceof ImageUploadError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[${tag}]`, err instanceof Error ? err.message : "unknown");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function uploadStoreImage(req: NextRequest, kind: StoreImageKind) {
  const tag = `api/vendor/${kind} POST`;
  const field = FIELD[kind];
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    // Validated before touching Blob storage — never pay for an upload we reject.
    const { file, ext } = await readImageUpload(req);

    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) return unavailable();

    const previous = ctx.vendor[field];
    const blob = await put(`store/${ctx.vendor.id}/${kind}.${ext}`, file, {
      access: "public",
      token,
      contentType: file.type,
      addRandomSuffix: true,
    });

    try {
      await prisma.vendor.update({ where: { id: ctx.vendor.id }, data: { [field]: blob.url } });
    } catch (e) {
      // Don't leave the new blob behind if the row could not be written.
      await deleteBlobQuietly(blob.url, token, tag);
      throw e;
    }
    await deleteBlobQuietly(previous, token, tag);

    return withVendorCookie(NextResponse.json({ data: { url: blob.url } }), ctx.setVendorCookie);
  } catch (err) {
    return errorResponse(err, tag);
  }
}

export async function removeStoreImage(req: NextRequest, kind: StoreImageKind) {
  const tag = `api/vendor/${kind} DELETE`;
  const field = FIELD[kind];
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const previous = ctx.vendor[field];

    // Resolved before the write so a missing token fails cleanly rather than
    // clearing the row and orphaning the blob.
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (previous && !token) return unavailable();

    await prisma.vendor.update({ where: { id: ctx.vendor.id }, data: { [field]: null } });
    if (previous && token) await deleteBlobQuietly(previous, token, tag);

    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return errorResponse(err, tag);
  }
}
