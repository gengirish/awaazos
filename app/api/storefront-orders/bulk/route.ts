import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toBoardOrder } from "@/lib/drops-board-server";
import { bumpDropOrderSignal } from "@/lib/drops-signal";
import { MENU_ORDERS_SIGNAL_ID } from "@/lib/menu-orders";
import { bulkOrderActionSchema } from "@/lib/order-bulk";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { runBulkStorefrontOrderAction } from "@/lib/storefront-order-bulk";

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

/**
 * POST /api/storefront-orders/bulk — `{ orderIds: string[1..50], action }`
 * where action is confirm | mark_paid | deliver (lib/order-bulk.ts) on
 * "order from menu" orders.
 *
 * Each id runs in its own transaction with the single-order scope
 * `{ id, vendorId, source: STOREFRONT, dropId: null }` (lib/storefront-order-bulk.ts).
 * Always 200 once authorised: `{ data: { succeeded, failed, orders } }`. A drop
 * order, a counter sale or another vendor's order is `failed: not_found`.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { orderIds, action } = bulkOrderActionSchema.parse(await req.json());

    const result = await runBulkStorefrontOrderAction({
      runInTransaction: (fn) => prisma.$transaction(fn),
      vendorId: ctx.vendor.id,
      dropId: null,
      orderIds,
      action,
    });

    // One signal bump for the whole batch. Fire-and-forget.
    if (result.succeeded.length > 0) void bumpDropOrderSignal(ctx.vendor.id, MENU_ORDERS_SIGNAL_ID);

    const res = NextResponse.json({
      data: {
        succeeded: result.succeeded,
        failed: result.failed,
        orders: result.updated.map((row) => toBoardOrder(row)),
      },
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    console.error("[api/storefront-orders/bulk POST]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
