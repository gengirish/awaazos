import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { menuItemUpdateSchema, parseAliasesCsv } from "@/lib/zod-menu";

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
    if (body.name !== undefined) data.name = body.name;
    if (body.priceInRupees !== undefined) {
      data.priceInPaise = rupeesToPaise(body.priceInRupees);
    }
    if (body.aliasesCsv !== undefined) data.aliases = parseAliasesCsv(body.aliasesCsv);
    if (body.emoji !== undefined) data.emoji = body.emoji;
    if (body.category !== undefined) data.category = body.category;
    if (body.isPopular !== undefined) data.isPopular = body.isPopular;
    if (body.isAvailable !== undefined) data.isAvailable = body.isAvailable;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

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
