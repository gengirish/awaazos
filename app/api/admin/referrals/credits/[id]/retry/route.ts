import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { settleReferralCredit } from "@/lib/referral-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: send a pending free-month refund again (SUPER_ADMIN). Safe to repeat:
 * `settleReferralCredit` records a refund Razorpay already holds instead of
 * refunding twice. Anyone else gets 404.
 */
export const POST = adminRoute<{ id: string }>("SUPER_ADMIN", "admin-referral-credit-retry", async (_req, { params }) => {
  const result = await settleReferralCredit(params.id);
  if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.kind === "failed") {
    return NextResponse.json({ error: "refund_failed", message: result.error }, { status: 502 });
  }
  return NextResponse.json({ data: { status: "REFUNDED" } });
});
