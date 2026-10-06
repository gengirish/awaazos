import { NextRequest, NextResponse } from "next/server";

import { pushErrorResponse, withVendorCookie } from "@/lib/push-devices";
import { prisma } from "@/lib/prisma";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/push/subscriptions/:id — remove one of the current user's
 * devices for the active vendor. Anyone else's row (other staff, other
 * vendor) is a 404, never a 403.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);

    const rl = await writeRateLimit.check(`push-sub:${ctx.user.id}`);
    if (!rl.ok) return tooManyRequests(rl, "push-subscriptions");

    const { count } = await prisma.pushSubscription.deleteMany({
      where: { id: params.id, userId: ctx.user.id, vendorId: ctx.vendor.id },
    });
    if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    console.info(JSON.stringify({ event: "push_device_removed", vendorId: ctx.vendor.id }));
    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return pushErrorResponse(err, "subscription_delete");
  }
}
