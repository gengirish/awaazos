import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { itemVariantsSchema } from "@/lib/item-variants-schema";
import { withVariants } from "@/lib/menu-stock-server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

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

/** Thrown inside the transaction; mapped to its status below. */
class VariantsRouteError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/**
 * PUT /api/menu/[id]/variants — replace the item's sizes / colours with
 * `{ variants: [...] }`, in that order (rules in lib/item-variants.ts). Ids not
 * in the list are deleted; their bills keep the name snapshot. A variant's
 * `stockQty` records a new count only when sent (null stops tracking). Giving
 * an item variants stops its own count. An item in a drop may get sizes too:
 * from then on its drop orders name one (lib/item-variants.ts rule 7). Returns
 * the item's variants with their stock.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const body = itemVariantsSchema.parse(await req.json());
    const vendorId = ctx.vendor.id;
    const now = new Date();

    const variants = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.findFirst({
        where: { id: params.id, vendorId },
        select: { id: true, stockQty: true, variants: { select: { id: true } } },
      });
      if (!item) throw new VariantsRouteError(404, "Not found");
      const menuItemId = item.id;

      // Every id sent must be one of this item's variants: another item's or
      // another store's is a 404, never a quiet move.
      const own = new Set(item.variants.map((v) => v.id));
      if (body.variants.some((v) => v.id && !own.has(v.id))) throw new VariantsRouteError(404, "Not found");

      const keep = body.variants.flatMap((v) => (v.id ? [v.id] : []));
      await tx.itemVariant.deleteMany({ where: { vendorId, menuItemId, id: { notIn: keep } } });

      for (const [sortOrder, v] of body.variants.entries()) {
        const fields = {
          label: v.label,
          priceInPaise: v.priceInRupees == null ? null : rupeesToPaise(v.priceInRupees),
          isAvailable: v.isAvailable ?? true,
          sortOrder,
          ...(v.lowStockAt !== undefined ? { lowStockAt: v.lowStockAt } : {}),
          // A new count moves its time (lib/inventory.ts rule 2); absent leaves both.
          ...(v.stockQty !== undefined ? { stockQty: v.stockQty, stockCountedAt: v.stockQty === null ? null : now } : {}),
        };
        if (v.id) {
          await tx.itemVariant.updateMany({ where: { id: v.id, menuItemId, vendorId }, data: fields });
        } else {
          await tx.itemVariant.create({ data: { vendorId, menuItemId, ...fields } });
        }
      }

      // The item is counted by variant now (rule 4).
      if (body.variants.length > 0 && item.stockQty !== null) {
        await tx.menuItem.updateMany({
          where: { id: menuItemId, vendorId },
          data: { stockQty: null, stockCountedAt: null, lowStockAt: null },
        });
      }

      const [withRows] = await withVariants(tx, vendorId, [{ id: menuItemId }], now);
      return withRows.variants;
    });

    return withVendorCookie(NextResponse.json({ data: variants }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof VariantsRouteError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("[api/menu/[id]/variants PUT]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
