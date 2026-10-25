import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { BOARD_PASS_HEADER, verifyBoardPass } from "@/lib/board-pass";
import { getOrderSignal } from "@/lib/drops-signal";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/storefront-orders/signal — `{ signal: number | null }` for the
 * orders board (menu and drop orders); null = KV unavailable, the client falls
 * back to a slow direct refresh.
 *
 * With an `x-board-pass` header (lib/board-pass.ts) this reads no Postgres at
 * all: the pass is checked against the JWT session (cookie decode only) and
 * only the vendor-scoped Upstash counter is read, so the board can poll often
 * while Neon sleeps. A bad, expired or someone else's pass is 401
 * `board_pass_invalid`; the board then reloads (full role check) for a new one.
 * Without the header it runs the full requireVendorRole check, as before.
 */
export async function GET(req: NextRequest) {
  try {
    const passHeader = req.headers.get(BOARD_PASS_HEADER);
    let vendorId: string;
    if (passHeader !== null) {
      const pass = verifyBoardPass(passHeader);
      const session = pass ? await auth() : null;
      if (!pass || !session?.user?.id || session.user.id !== pass.userId) {
        return NextResponse.json({ error: "board_pass_invalid" }, { status: 401 });
      }
      vendorId = pass.vendorId;
    } else {
      vendorId = (await requireVendorRole("CASHIER", undefined, req)).vendor.id;
    }
    const signal = await getOrderSignal(vendorId);
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
