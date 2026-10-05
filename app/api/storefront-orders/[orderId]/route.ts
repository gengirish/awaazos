import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toBoardOrder } from "@/lib/drops-board-server";
import { bumpDropOrderSignal } from "@/lib/drops-signal";
import { MENU_ORDERS_SIGNAL_ID } from "@/lib/menu-orders";
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
 * PATCH /api/storefront-orders/[orderId] — `{ action }` on an "order from
 * menu" order (confirm | mark_paid | cancel | deliver | undeliver; see
 * lib/storefront-order-actions.ts). Scoped to `{ id, vendorId, source:
 * STOREFRONT, dropId: null }`: a drop order, a counter sale or another
 * vendor's order is a 404. No frozen rule — there is no drop.
 */
export async function PATCH(req: NextRequest, { params }: { params: { orderId: string } }) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { action } = bodySchema.parse(await req.json());
    const scope = storefrontOrderScope({ orderId: params.orderId, vendorId: ctx.vendor.id, dropId: null });

    const updated = await prisma.$transaction((tx) =>
      applyStorefrontOrderAction(tx, { scope, action, dropStatus: null }),
    );

    // Let the vendor's other phones notice the change. Fire-and-forget.
    void bumpDropOrderSignal(ctx.vendor.id, MENU_ORDERS_SIGNAL_ID);

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
    console.error("[api/storefront-orders/[orderId] PATCH]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
