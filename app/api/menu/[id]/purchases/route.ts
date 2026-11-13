import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { receiveStockSchema } from "@/lib/stock-purchase-schema";
import { ReceiveStockError, receiveStock, recentPurchases } from "@/lib/stock-purchase-server";

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

function failure(err: unknown, where: string) {
  if (err instanceof ReceiveStockError) {
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
  console.error(where, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** GET /api/menu/[id]/purchases — the item's latest purchases (MANAGER; lib/stock-purchase.ts). */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const item = await prisma.menuItem.findFirst({
      where: { id: params.id, vendorId: ctx.vendor.id },
      select: { id: true },
    });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = await recentPurchases(prisma, ctx.vendor.id, item.id);
    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    return failure(err, "[api/menu/[id]/purchases GET]");
  }
}

/**
 * POST /api/menu/[id]/purchases — "Received": `{ lines: [{ qty, variantId? }],
 * costInRupees? }`. Moves each count up like +n, writes one purchase per line
 * and, when a cost is given, makes it the latest cost, all in one transaction
 * (lib/stock-purchase.ts). MANAGER and up. Not a sale, so no billing lock.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("MANAGER", undefined, req);
    const body = receiveStockSchema.parse(await req.json());
    const data = await prisma.$transaction((tx) =>
      receiveStock(tx, {
        vendorId: ctx.vendor.id,
        menuItemId: params.id,
        lines: body.lines,
        costInPaise: body.costInRupees == null ? undefined : rupeesToPaise(body.costInRupees),
        userId: ctx.user.id,
      }),
    );
    return withVendorCookie(NextResponse.json({ data }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    return failure(err, "[api/menu/[id]/purchases POST]");
  }
}
