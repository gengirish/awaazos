import { NextRequest, NextResponse } from "next/server";

import { getDropOrderSignal } from "@/lib/drops-signal";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/drops/[id]/signal — `{ signal: number | null }`.
 *
 * The board polls this instead of the orders list. Apart from the session /
 * membership check inside requireVendorRole, it does not touch Postgres: the
 * counter lives in Upstash (lib/drops-signal.ts). null = KV unavailable, the
 * client falls back to a slow direct refresh.
 *
 * The KV key is scoped by vendorId, so a vendor can only ever read counters for
 * their own drops without an extra Postgres read per poll; the orders GET,
 * which returns real data, does the compound vendorId check.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const signal = await getDropOrderSignal(ctx.vendor.id, params.id);
    const res = NextResponse.json({ signal });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/drops/[id]/signal GET]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
