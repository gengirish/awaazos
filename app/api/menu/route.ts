import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { deduplicateSlug, generateSlug, suggestAliases } from "@/lib/menu-suggestions";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { menuItemCreateSchema } from "@/lib/zod-menu";

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const items = await prisma.menuItem.findMany({
      where: { vendorId: ctx.vendor.id },
      orderBy: { sortOrder: "asc" },
    });
    const res = NextResponse.json({ data: items });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/menu GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const body = menuItemCreateSchema.parse(await req.json());

    const [existingItems, maxSort] = await Promise.all([
      prisma.menuItem.findMany({
        where: { vendorId: ctx.vendor.id },
        select: { slug: true },
      }),
      prisma.menuItem.aggregate({
        where: { vendorId: ctx.vendor.id },
        _max: { sortOrder: true },
      }),
    ]);

    const existingSlugs = new Set(
      existingItems.map((r) => r.slug).filter((s): s is string => s !== null),
    );
    const slug = deduplicateSlug(generateSlug(body.name), existingSlugs);

    // Merge auto-suggested aliases with any manually entered ones; deduplicate.
    const suggested = suggestAliases(body.name);
    const aliases = Array.from(new Set([...suggested, ...body.aliases]));

    const nextOrder = (maxSort._max.sortOrder ?? -1) + 1;

    const created = await prisma.menuItem.create({
      data: {
        vendorId: ctx.vendor.id,
        name: body.name,
        slug,
        aliases,
        tags: body.tags,
        priceInPaise: body.priceInPaise,
        emoji: body.emoji,
        category: body.category,
        hsnCode: body.hsnCode,
        isPopular: body.isPopular,
        isAvailable: body.isAvailable,
        sortOrder: nextOrder,
      },
    });

    const res = NextResponse.json({ data: created }, { status: 201 });
    return withVendorCookie(res, ctx.setVendorCookie);
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
    console.error("[api/menu POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
