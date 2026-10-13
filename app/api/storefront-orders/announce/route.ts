import { OrderSource } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { spokenName } from "@/lib/order-voice";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const billSchema = z.string().regex(/^AWZ-\d{8}-\d{4,}$/);

/**
 * GET /api/storefront-orders/announce?bill=AWZ-YYYYMMDD-NNNN —
 * `{ data: { firstName: string | null } }` for the spoken new-order alert
 * (lib/order-voice.ts). The push that triggers the alert carries no buyer
 * details, so the page asks for the first name here, as signed-in staff.
 *
 * A read of an existing order: no billing lock. Returns the first name only —
 * never the full name, phone or address — and logs none of it. Another
 * vendor's bill and an unknown bill are both 404.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const bill = billSchema.safeParse(req.nextUrl.searchParams.get("bill"));
    if (!bill.success) {
      return NextResponse.json({ error: "Invalid bill number" }, { status: 400 });
    }
    const order = await prisma.transaction.findFirst({
      where: { vendorId: ctx.vendor.id, billNumber: bill.data, source: OrderSource.STOREFRONT },
      select: { customerName: true },
    });
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const res = NextResponse.json({ data: { firstName: spokenName(order.customerName) } });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/storefront-orders/announce GET]", err instanceof Error ? err.name : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
