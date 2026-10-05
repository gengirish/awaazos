import { NextRequest, NextResponse } from "next/server";

import { getDropOrderSignal } from "@/lib/drops-signal";
import { MENU_ORDERS_SIGNAL_ID } from "@/lib/menu-orders";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/storefront-orders/signal — `{ signal: number | null }` for the
 * "order from menu" board. Reads only the vendor-scoped Upstash counter (plus
 * the session / membership check in requireVendorRole); null = KV unavailable,
 * the client falls back to a slow direct refresh.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const signal = await getDropOrderSignal(ctx.vendor.id, MENU_ORDERS_SIGNAL_ID);
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
