import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { cancelOrder, markOrderPaid } from "@/lib/drops";
import { ORDER_ACTIONS, checkOrderAction } from "@/lib/drops-board";
import { boardOrderSelect, toBoardOrder } from "@/lib/drops-board-server";
import { bumpDropOrderSignal } from "@/lib/drops-signal";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

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

class ActionFailed extends Error {
  constructor(
    public readonly status: 404 | 409,
    public readonly code: "Not found" | "drop_frozen" | "invalid_state",
  ) {
    super(code);
  }
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
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; orderId: string } },
) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const { action } = bodySchema.parse(await req.json());
    const vendorId = ctx.vendor.id;
    const dropId = params.id;
    const orderId = params.orderId;
    const scope = { id: orderId, vendorId, dropId, source: "STOREFRONT" as const };

    const updated = await prisma.$transaction(async (tx) => {
      const drop = await tx.drop.findFirst({ where: { id: dropId, vendorId }, select: { status: true } });
      if (!drop) throw new ActionFailed(404, "Not found");

      const order = await tx.transaction.findFirst({
        where: scope,
        select: { fulfilmentStatus: true, paymentStatus: true, paymentMethod: true },
      });
      if (!order) throw new ActionFailed(404, "Not found");

      const check = checkOrderAction(action, drop.status, order);
      if (!check.ok) throw new ActionFailed(409, check.error);

      let applied = false;
      switch (action) {
        case "confirm": {
          const r = await tx.transaction.updateMany({
            where: { ...scope, fulfilmentStatus: "PLACED" },
            data: { fulfilmentStatus: "CONFIRMED" },
          });
          applied = r.count === 1;
          break;
        }
        case "mark_paid": {
          // Order already verified in this txn as (orderId, vendorId, dropId).
          applied = await markOrderPaid(tx, { vendorId, transactionId: orderId });
          break;
        }
        case "cancel": {
          applied = await cancelOrder(tx, { vendorId, transactionId: orderId });
          break;
        }
        case "deliver": {
          const r = await tx.transaction.updateMany({
            where: { ...scope, fulfilmentStatus: { in: ["PLACED", "CONFIRMED"] } },
            data: { fulfilmentStatus: "DELIVERED" },
          });
          applied = r.count === 1;
          if (applied && order.paymentMethod === "CASH" && order.paymentStatus !== "PAID") {
            // Pay-on-delivery collected at the door. A false here means a
            // concurrent tap already marked it paid — fine either way.
            await markOrderPaid(tx, { vendorId, transactionId: orderId });
          }
          break;
        }
        case "undeliver": {
          const r = await tx.transaction.updateMany({
            where: { ...scope, fulfilmentStatus: "DELIVERED" },
            data: { fulfilmentStatus: "CONFIRMED" },
          });
          applied = r.count === 1;
          break;
        }
      }
      if (!applied) throw new ActionFailed(409, "invalid_state");

      return tx.transaction.findFirstOrThrow({ where: scope, select: boardOrderSelect });
    });

    // Let the vendor's other phones notice the change. Fire-and-forget.
    void bumpDropOrderSignal(ctx.vendor.id, dropId);

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
    if (err instanceof ActionFailed) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    console.error("[api/drops/[id]/orders/[orderId] PATCH]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
