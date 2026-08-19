import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { deduplicateSlug, generateSlug } from "@/lib/menu-suggestions";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { menuItemUpdateSchema, parseAliasesCsv, parseTagsCsv } from "@/lib/zod-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const body = menuItemUpdateSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      data.name = body.name;
      // Regenerate slug when the name changes, preserving uniqueness.
      const siblings = await prisma.menuItem.findMany({
        where: { vendorId: ctx.vendor.id, NOT: { id: params.id } },
        select: { slug: true },
      });
      const existingSlugs = new Set(
        siblings.map((r) => r.slug).filter((s): s is string => s !== null),
      );
      data.slug = deduplicateSlug(generateSlug(body.name), existingSlugs);
    }
    if (body.priceInRupees !== undefined) {
      data.priceInPaise = rupeesToPaise(body.priceInRupees);
    }
    if (body.aliasesCsv !== undefined) data.aliases = parseAliasesCsv(body.aliasesCsv);
    if (body.tagsCsv !== undefined) data.tags = parseTagsCsv(body.tagsCsv);
    if (body.emoji !== undefined) data.emoji = body.emoji;
    if (body.category !== undefined) data.category = body.category;
    if (body.hsnCode !== undefined) {
      const hsn = body.hsnCode?.trim();
      data.hsnCode = hsn ? hsn.toUpperCase() : null;
    }
    if (body.isPopular !== undefined) data.isPopular = body.isPopular;
    if (body.isAvailable !== undefined) data.isAvailable = body.isAvailable;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    // `null` clears the photo. The blob itself is removed by
    // DELETE /api/menu/[id]/image, which is the path the UI uses.
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;

    try {
      const updated = await prisma.menuItem.update({
        where: { id: params.id, vendorId: ctx.vendor.id },
        data: data as Prisma.MenuItemUpdateInput,
      });
      const res = NextResponse.json({ data: updated });
      return withVendorCookie(res, ctx.setVendorCookie);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof Error && err.message.includes("Rupee amount")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/menu PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    try {
      await prisma.menuItem.update({
        where: { id: params.id, vendorId: ctx.vendor.id },
        data: { isAvailable: false },
      });
      const res = NextResponse.json({ success: true });
      return withVendorCookie(res, ctx.setVendorCookie);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/menu DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
