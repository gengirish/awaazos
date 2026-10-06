import { NextRequest, NextResponse } from "next/server";

import { isPushConfigured, sendToVendor } from "@/lib/push";
import { pushErrorResponse, pushNotConfigured, pushTestRateLimit, withVendorCookie } from "@/lib/push-devices";
import { tooManyRequests } from "@/lib/ratelimit";
import { requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/push/test — send a test alert to the current user's own devices only. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    if (!isPushConfigured()) return pushNotConfigured();

    const rl = await pushTestRateLimit.check(ctx.user.id);
    if (!rl.ok) return tooManyRequests(rl, "push-test");

    const { sent } = await sendToVendor(
      ctx.vendor.id,
      { title: "🔔 Test alert", body: "Alerts are working on this device.", url: "/orders", tag: "test" },
      { userId: ctx.user.id },
    );
    return withVendorCookie(NextResponse.json({ data: { sent } }), ctx.setVendorCookie);
  } catch (err) {
    return pushErrorResponse(err, "test");
  }
}
