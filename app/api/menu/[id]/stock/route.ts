import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  lockTrackedMenuItems,
  lockTrackedVariants,
  recordStockAdjust,
  recordStockCount,
  recordVariantStockAdjust,
  recordVariantStockCount,
  stockLeftByMenuItem,
  stockLeftByVariant,
  stockSetAsideByVariant,
} from "@/lib/inventory-server";
import { withStockLeft } from "@/lib/menu-stock-server";
import { adjustDelta, stockChangeSchema, type StockChange } from "@/lib/menu-stock";
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
class StockRouteError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** The same change for one variant, compound-scoped to this vendor and item; 404 for any other id. */
async function changeVariantStock(
  tx: Prisma.TransactionClient,
  vendorId: string,
  menuItemId: string,
  variantId: string,
  body: StockChange,
) {
  const variant = await tx.itemVariant.findFirst({ where: { id: variantId, menuItemId, vendorId }, select: { id: true } });
  if (!variant) throw new StockRouteError(404, "Not found");
  if ("set" in body) {
    await recordVariantStockCount(tx, vendorId, menuItemId, variant.id, body.set);
  } else {
    // Locked like an order taking this variant, so "left" can't move under us.
    const [locked] = await lockTrackedVariants(tx, vendorId, [variant.id]);
    if (!locked) throw new StockRouteError(409, "stock_not_tracked");
    const left = (await stockLeftByVariant(tx, vendorId, [locked])).get(variant.id) ?? 0;
    const delta = adjustDelta(left, body.adjust);
    if (delta !== 0) await recordVariantStockAdjust(tx, vendorId, menuItemId, variant.id, delta);
  }
  const row = await tx.itemVariant.findFirstOrThrow({
    where: { id: variant.id, menuItemId, vendorId },
    select: { id: true, stockQty: true, stockCountedAt: true, lowStockAt: true },
  });
  const [left, setAside] = await Promise.all([
    stockLeftByVariant(tx, vendorId, [row]),
    stockSetAsideByVariant(tx, vendorId, [row]),
  ]);
  return {
    variantId: row.id,
    stockQty: row.stockQty,
    stockLeft: left.get(row.id) ?? null,
    stockSetAside: setAside.get(row.id) ?? null,
    lowStockAt: row.lowStockAt,
  };
}

/**
 * POST /api/menu/[id]/stock — `{ set: n }` records a count; `{ adjust: ±n }`
 * ("+5 received", "−1 damaged") moves the count so left becomes left + n
 * (kept at 0 or more), without moving `stockCountedAt`: open orders keep
 * counting, and a lapsed hold or a cancel still gives stock back. Rules in
 * lib/inventory.ts (2a). With `variantId` it acts on that size / colour of
 * the item (lib/item-variants.ts rule 4); an item that has them keeps no count
 * of its own (409 `has_variants`). Not a sale,
 * so no billing lock: a locked store can still count its shelf.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const body = stockChangeSchema.parse(await req.json());
    const vendorId = ctx.vendor.id;

    const data = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.findFirst({
        where: { id: params.id, vendorId },
        select: { id: true, _count: { select: { variants: true } } },
      });
      if (!item) throw new StockRouteError(404, "Not found");

      if (body.variantId) return changeVariantStock(tx, vendorId, item.id, body.variantId, body);
      if (item._count.variants > 0) throw new StockRouteError(409, "has_variants");

      if ("set" in body) {
        await recordStockCount(tx, vendorId, item.id, body.set);
      } else {
        // The row lock serialises this with orders taking the same item, so
        // "left" can't move between the read and the change (rule 4).
        const [locked] = await lockTrackedMenuItems(tx, vendorId, [item.id]);
        if (!locked) throw new StockRouteError(409, "stock_not_tracked");
        const left = (await stockLeftByMenuItem(tx, vendorId, [locked])).get(item.id) ?? 0;
        const delta = adjustDelta(left, body.adjust);
        if (delta !== 0) await recordStockAdjust(tx, vendorId, item.id, delta);
      }

      const row = await tx.menuItem.findUniqueOrThrow({
        where: { id: item.id, vendorId },
        select: { id: true, stockQty: true, stockCountedAt: true, lowStockAt: true },
      });
      const [stock] = await withStockLeft(tx, vendorId, [row]);
      return {
        stockQty: row.stockQty,
        stockLeft: stock.stockLeft,
        stockSetAside: stock.stockSetAside,
        lowStockAt: row.lowStockAt,
      };
    });

    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof StockRouteError) {
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
    console.error("[api/menu/[id]/stock POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
