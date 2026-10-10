import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { deleteBlobQuietly, ImageUploadError, readImageUpload } from "@/lib/blob-image";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Menu item photo upload.
 *
 * POST   multipart/form-data, field `file` → { data: MenuItem }   200
 * DELETE (no body)                        → { success: true }     200
 *
 * Size/type rules and Blob housekeeping are shared with the store banner and
 * logo: lib/blob-image.ts.
 */
const TAG = "api/menu image";

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    // Validated before touching Blob storage — never pay for an upload we reject.
    const { file, ext } = await readImageUpload(req);

    // Ownership check first, so a forged id 404s without an upload happening.
    const existing = await prisma.menuItem.findFirst({
      where: { id: params.id, vendorId: ctx.vendor.id },
      select: { id: true, imageUrl: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const token = requireEnv("BLOB_READ_WRITE_TOKEN");
    const blob = await put(`menu/${ctx.vendor.id}/${existing.id}.${ext}`, file, {
      access: "public",
      token,
      contentType: file.type,
      addRandomSuffix: true,
    });

    try {
      const updated = await prisma.menuItem.update({
        where: { id: params.id, vendorId: ctx.vendor.id },
        data: { imageUrl: blob.url },
      });
      await deleteBlobQuietly(existing.imageUrl, token, TAG);
      const res = NextResponse.json({ data: updated });
      return withVendorCookie(res, ctx.setVendorCookie);
    } catch (e) {
      // Row vanished between the check and the write — don't leave the blob behind.
      await deleteBlobQuietly(blob.url, token, TAG);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof AuthError || err instanceof ImageUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/menu image POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    const existing = await prisma.menuItem.findFirst({
      where: { id: params.id, vendorId: ctx.vendor.id },
      select: { id: true, imageUrl: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolved before the write so a missing token fails cleanly rather than
    // clearing the row and orphaning the blob.
    const token = existing.imageUrl ? requireEnv("BLOB_READ_WRITE_TOKEN") : null;

    try {
      await prisma.menuItem.update({
        where: { id: params.id, vendorId: ctx.vendor.id },
        data: { imageUrl: null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw e;
    }

    if (token) {
      await deleteBlobQuietly(existing.imageUrl, token, TAG);
    }

    const res = NextResponse.json({ success: true });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/menu image DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
