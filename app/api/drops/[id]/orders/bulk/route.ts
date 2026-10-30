import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toBoardOrder } from "@/lib/drops-board-server";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { bulkOrderActionSchema } from "@/lib/order-bulk-schema";
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
 * POST /api/drops/[id]/orders/bulk — `{ orderIds: string[1..50], action }`
 * where action is confirm | mark_paid | deliver (lib/order-bulk.ts).
 *
 * The drop must be this vendor's (compound `{ id, vendorId }`), else 404.
 * Each id then runs in its own transaction with the single-order scope
 * `{ id, vendorId, source: STOREFRONT, dropId }` and the frozen rule
 * (lib/storefront-order-bulk.ts). 200 `{ data: { succeeded, failed, orders } }`;
 * an id from another drop or another vendor is `failed: not_found`.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { orderIds, action } = bulkOrderActionSchema.parse(await req.json());
    const vendorId = ctx.vendor.id;
    const dropId = params.id;

    const drop = await prisma.drop.findFirst({ where: { id: dropId, vendorId }, select: { id: true } });
    if (!drop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await runBulkStorefrontOrderAction({
      runInTransaction: (fn) => prisma.$transaction(fn),
      vendorId,
      dropId,
      orderIds,
      action,
    });

    // One signal bump for the whole batch. Fire-and-forget.
    if (result.succeeded.length > 0) void bumpOrderSignal(vendorId);

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
    console.error("[api/drops/[id]/orders/bulk POST]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
