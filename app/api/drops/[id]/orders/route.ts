import { NextRequest, NextResponse } from "next/server";

import { loadDropBoard } from "@/lib/drops-board-server";
import { getDropOrderSignal } from "@/lib/drops-signal";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * GET /api/drops/[id]/orders — the vendor's storefront orders for one drop,
 * newest first, with summary chips and the prep (cook) list.
 *
 * Contains customer name / phone / address: vendor-only, never logged.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    // Read the signal first: if an order lands between the two reads, the next
    // poll sees a higher number and refetches, rather than the board missing it.
    const signal = await getDropOrderSignal(ctx.vendor.id, params.id);
    const board = await loadDropBoard(ctx.vendor.id, params.id);
    if (!board) {
      return withVendorCookie(NextResponse.json({ error: "Not found" }, { status: 404 }), ctx.setVendorCookie);
    }
    const res = NextResponse.json({
      data: board.orders,
      summary: board.summary,
      prep: board.prep,
      drop: board.drop,
      signal,
    });
    res.headers.set("Cache-Control", "no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/drops/[id]/orders GET]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
