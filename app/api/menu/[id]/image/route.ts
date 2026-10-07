import { del, put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

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
 * Vendors shoot these on a phone over metered mobile data, so the cap is
 * deliberately small and enforced BEFORE anything is streamed to Blob.
 * 4 MB also stays under Vercel's ~4.5 MB serverless request body limit.
 */
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

/**
 * Removing the old blob is housekeeping, not part of the contract: the row
 * already points somewhere valid either way, so a failure here is logged and
 * swallowed rather than failing the vendor's upload.
 */
async function deleteBlobQuietly(url: string | null | undefined, token: string) {
  if (!url) return;
  try {
    await del(url, { token });
  } catch (e) {
    console.error("[api/menu image] orphaned blob", e);
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    // Cheap pre-check: formData() buffers the whole body in memory, so reject
    // an oversized upload from the header before paying for that.
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be 4MB or smaller" }, { status: 400 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // Validate before touching Blob storage — never pay for an upload we reject.
    const ext = ALLOWED_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPEG, PNG or WebP." },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Image is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be 4MB or smaller" }, { status: 400 });
    }

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
      await deleteBlobQuietly(existing.imageUrl, token);
      const res = NextResponse.json({ data: updated });
      return withVendorCookie(res, ctx.setVendorCookie);
    } catch (e) {
      // Row vanished between the check and the write — don't leave the blob behind.
      await deleteBlobQuietly(blob.url, token);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof AuthError) {
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
      await deleteBlobQuietly(existing.imageUrl, token);
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
