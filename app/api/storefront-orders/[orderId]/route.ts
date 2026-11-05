import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toBoardOrder } from "@/lib/drops-board-server";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { RIDER_NAME_MAX } from "@/lib/delivery-riders";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole, staffRoleAtLeast } from "@/lib/rbac";
import {
  ORDER_ACTIONS,
  OrderActionError,
  applyStorefrontOrderAction,
  storefrontOrderScope,
} from "@/lib/storefront-order-actions";
import { prepareOrderMoney } from "@/lib/storefront-order-refund";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `riderName` goes with dispatch only: the saved rider it was sent to. `refund` goes
// with cancel only: "manual" is the seller's "Cancel anyway, I'll refund from Razorpay".
const bodySchema = z.object({
  action: z.enum(ORDER_ACTIONS),
  riderName: z.string().trim().max(RIDER_NAME_MAX).optional(),
  refund: z.enum(["razorpay", "manual"]).optional(),
});

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
 * menu" order (confirm | mark_paid | cancel | dispatch | deliver | undeliver |
 * refund_payment_issue | keep_payment_issue; see
 * lib/storefront-order-actions.ts). Scoped to `{ id, vendorId, source:
 * STOREFRONT, dropId: null }`: a drop order, a counter sale or another
 * vendor's order is a 404. No frozen rule — there is no drop. Refunds need MANAGER
 * (lib/storefront-order-refund.ts): 403 `manager_required`, 409 `refund_failed`.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ orderId: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { action, riderName, refund } = bodySchema.parse(await req.json());
    const scope = storefrontOrderScope({ orderId: params.orderId, vendorId: ctx.vendor.id, dropId: null });

    // Any refund happens first, outside the transaction; a refusal stops here.
    const money = await prepareOrderMoney({ scope, action, refund, canRefund: staffRoleAtLeast(ctx.staff.role, "MANAGER") });
    const updated = await prisma.$transaction((tx) =>
      applyStorefrontOrderAction(tx, { scope, action, riderName, dropStatus: null, ...money }),
    );

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
      return NextResponse.json({ error: err.code, ...(err.reason ? { reason: err.reason } : {}) }, { status: err.status });
    }
    console.error("[api/storefront-orders/[orderId] PATCH]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
