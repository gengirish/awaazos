import { NextRequest, NextResponse } from "next/server";

import { mintBoardPass } from "@/lib/board-pass";
import { loadOrdersBoard } from "@/lib/drops-board-server";
import { getOrderSignal } from "@/lib/drops-signal";
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
 * GET /api/storefront-orders — everything on the vendor's orders board: menu
 * orders and drop orders together, newest first (window in `ordersBoardWhere`),
 * plus the drops the board can be narrowed to.
 * `{ data: BoardOrder[], drops: BoardDrop[], summary, signal, pass }` — `pass` is a
 * fresh board pass for the Postgres-free signal check (lib/board-pass.ts).
 *
 * `?drop=<id>` keeps that drop and all its orders on the board even when it is
 * long past; an id that is not this vendor's matches nothing.
 *
 * Contains customer name / phone / address: vendor-only, never logged.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    // Signal first: an order landing between the two reads bumps the counter
    // past what we return, so the next poll refetches instead of missing it.
    const signal = await getOrderSignal(ctx.vendor.id);
    const board = await loadOrdersBoard(ctx.vendor.id, { pinDropId: req.nextUrl.searchParams.get("drop") });
    const pass = mintBoardPass({ vendorId: ctx.vendor.id, userId: ctx.user.id });
    const res = NextResponse.json({ data: board.orders, drops: board.drops, summary: board.summary, signal, pass });
    res.headers.set("Cache-Control", "no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/storefront-orders GET]", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
