import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ON_MENU } from "@/lib/menu-archive";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { menuCategoryRenameSchema } from "@/lib/zod-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/menu/categories { from, to } — rename a category. A category is the
 * free-text `MenuItem.category`, so this is one updateMany over this vendor's items
 * on the menu that carry `from`. Another vendor's category name simply matches
 * none of ours: `{ updated: 0 }`. MANAGER and up, like the /menu tab.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const { from, to } = menuCategoryRenameSchema.parse(await req.json());

    const { count } = await prisma.menuItem.updateMany({
      where: { vendorId: ctx.vendor.id, category: from, ...ON_MENU },
      data: { category: to },
    });

    const res = NextResponse.json({ data: { updated: count } });
    if (ctx.setVendorCookie) {
      res.cookies.set("awz_vendor", ctx.setVendorCookie, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("[api/menu/categories PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
