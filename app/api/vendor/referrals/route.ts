import { NextResponse, type NextRequest } from "next/server";

import { withVendorCookie } from "@/lib/drops-api";
import { logger } from "@/lib/logger";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { loadReferralSummary } from "@/lib/referral-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Settings → Refer a seller (lib/referral.ts), OWNER only: this store's
 * referral counts. Counts only — never the referred stores' names or contact
 * details. A demo store has no referral program (404). Not billing-gated:
 * reading records stays open to a locked store.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    if (ctx.vendor.isDemo) {
      return withVendorCookie(
        NextResponse.json({ error: "Not found" }, { status: 404 }),
        ctx.setVendorCookie,
      );
    }
    const data = await loadReferralSummary({ id: ctx.vendor.id, slug: ctx.vendor.slug });
    return withVendorCookie(NextResponse.json({ data }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error(
      { route: "GET /api/vendor/referrals", error: err instanceof Error ? err.message : "unknown" },
      "referral summary failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
