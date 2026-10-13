import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toBoardOrder } from "@/lib/drops-board-server";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import {
  ORDER_ACTIONS,
  OrderActionError,
  applyStorefrontOrderAction,
  storefrontOrderScope,
} from "@/lib/storefront-order-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(ORDER_ACTIONS) });

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
 * PATCH /api/drops/[id]/orders/[orderId] — `{ action }`.
 *
 *   confirm    PLACED → CONFIRMED
 *   mark_paid  markOrderPaid (credits DailySummary once)
 *   cancel     cancelOrder (reverses revenue if it was paid; vendor refunds via UPI)
 *   deliver    PLACED|CONFIRMED → DELIVERED; unpaid CASH is marked paid in the same txn
 *   undeliver  DELIVERED → CONFIRMED (mistake fix; payment untouched)
 *
 * FROZEN / FULFILLED drops only allow mark_paid / deliver / undeliver.
 * The action logic is shared with menu orders: lib/storefront-order-actions.ts.
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; orderId: string }> }
) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { action } = bodySchema.parse(await req.json());
    const vendorId = ctx.vendor.id;
    const dropId = params.id;
    const orderId = params.orderId;
    const scope = storefrontOrderScope({ orderId, vendorId, dropId });

    const updated = await prisma.$transaction(async (tx) => {
      const drop = await tx.drop.findFirst({ where: { id: dropId, vendorId }, select: { status: true } });
      if (!drop) throw new OrderActionError(404, "Not found");
      return applyStorefrontOrderAction(tx, { scope, action, dropStatus: drop.status });
    });

    // Let the vendor's other phones notice the change. Fire-and-forget.
    void bumpOrderSignal(ctx.vendor.id);

    const res = NextResponse.json({ data: toBoardOrder(updated) });
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
    if (err instanceof OrderActionError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    console.error("[api/drops/[id]/orders/[orderId] PATCH]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
