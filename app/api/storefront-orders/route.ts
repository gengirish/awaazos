import { NextRequest, NextResponse } from "next/server";

import { loadMenuOrdersBoard } from "@/lib/drops-board-server";
import { getDropOrderSignal } from "@/lib/drops-signal";
import { MENU_ORDERS_SIGNAL_ID } from "@/lib/menu-orders";
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
 * GET /api/storefront-orders — the vendor's "order from menu" orders
 * (storefront, no drop): placed in the last 3 IST days plus any older one still
 * open, newest first. `{ data: BoardOrder[], summary, signal }`.
 *
 * Contains customer name / phone / address: vendor-only, never logged.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    // Signal first: an order landing between the two reads bumps the counter
    // past what we return, so the next poll refetches instead of missing it.
    const signal = await getDropOrderSignal(ctx.vendor.id, MENU_ORDERS_SIGNAL_ID);
    const board = await loadMenuOrdersBoard(ctx.vendor.id);
    const res = NextResponse.json({ data: board.orders, summary: board.summary, signal });
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
