import { NextRequest, NextResponse } from "next/server";

import { getOrderSignal } from "@/lib/drops-signal";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/storefront-orders/signal — `{ signal: number | null }` for the
 * orders board (menu and drop orders). Reads only the vendor-scoped Upstash counter (plus
 * the session / membership check in requireVendorRole); null = KV unavailable,
 * the client falls back to a slow direct refresh.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const signal = await getOrderSignal(ctx.vendor.id);
    const res = NextResponse.json({ signal });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/storefront-orders/signal GET]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
