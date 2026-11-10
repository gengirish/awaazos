import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { lockTrackedMenuItems, recordStockCount, stockLeftByMenuItem } from "@/lib/inventory-server";
import { adjustedCount, stockChangeSchema } from "@/lib/menu-stock";
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

/**
 * POST /api/menu/[id]/stock — `{ set: n }` records a count; `{ adjust: ±n }`
 * ("+5 received", "−1 damaged") records stock left + n as a new count
 * (lib/menu-stock.ts `adjustedCount`). Rules in lib/inventory.ts. Not a sale,
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
        select: { id: true },
      });
      if (!item) throw new StockRouteError(404, "Not found");

      let count: number;
      if ("set" in body) {
        count = body.set;
      } else {
        // The row lock serialises this with orders taking the same item, so
        // "left" can't move between the read and the new count (rule 4).
        const [locked] = await lockTrackedMenuItems(tx, vendorId, [item.id]);
        if (!locked) throw new StockRouteError(409, "stock_not_tracked");
        const left = (await stockLeftByMenuItem(tx, vendorId, [locked])).get(item.id) ?? 0;
        count = adjustedCount(left, body.adjust);
      }

      await recordStockCount(tx, vendorId, item.id, count);
      const row = await tx.menuItem.findUniqueOrThrow({
        where: { id: item.id, vendorId },
        select: { id: true, stockQty: true, stockCountedAt: true, lowStockAt: true },
      });
      const left = await stockLeftByMenuItem(tx, vendorId, [row]);
      return { stockQty: row.stockQty, stockLeft: left.get(row.id) ?? null, lowStockAt: row.lowStockAt };
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
