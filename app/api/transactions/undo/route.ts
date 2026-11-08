import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  billDayFromYmd,
  dailySummaryReversal,
  parseBillNumber,
  withinUndoWindow,
} from "@/lib/pos-undo";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  clientRef: z.string().uuid(),
  vendorId: z.string().min(1).optional(),
});

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

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * Undo a counter sale the POS rang up moments ago (lib/pos-undo.ts). Keyed on
 * the outbox `clientRef`, which only the device that made the sale holds.
 * Deletes the bill (items and receipt cascade), takes it back out of
 * DailySummary. Its bill number is not handed back: the receipt may already be
 * printed (auto-print) or shared, so the day's numbering keeps a gap instead.
 * No requireActiveBilling: reversing a sale is never blocked by a lock.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendor = ctx.vendor;

    const rl = await writeRateLimit.check(vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "transactions-undo");

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const { clientRef } = parsed.data;
    // Same rule as POST: never let the membership fallback act on another store.
    if (parsed.data.vendorId && parsed.data.vendorId !== vendor.id) return notFound();

    const sale = await prisma.transaction.findUnique({
      where: { vendorId_clientRef: { vendorId: vendor.id, clientRef } },
      select: {
        id: true,
        billNumber: true,
        totalPaise: true,
        paymentMethod: true,
        source: true,
        receipt: { select: { createdAt: true } },
        orderItems: { select: { qty: true } },
      },
    });
    // Storefront orders carry no clientRef; the check keeps it that way.
    if (!sale || sale.source === "STOREFRONT") return notFound();

    const bill = parseBillNumber(sale.billNumber);
    if (!sale.receipt || !bill) return notFound();
    if (!withinUndoWindow(sale.receipt.createdAt)) {
      return NextResponse.json({ error: "undo_window_closed", code: "undo_window_closed" }, { status: 409 });
    }

    const date = billDayFromYmd(bill.ymd);
    const reversal = dailySummaryReversal({
      totalPaise: sale.totalPaise,
      paymentMethod: sale.paymentMethod,
      itemQtys: sale.orderItems.map((i) => i.qty),
    });

    const removed = await prisma.$transaction(async (tx) => {
      const del = await tx.transaction.deleteMany({ where: { id: sale.id, vendorId: vendor.id } });
      // A second tap that lost the race: nothing left to take back out.
      if (del.count === 0) return false;

      await tx.dailySummary.updateMany({
        where: { vendorId: vendor.id, date },
        data: {
          totalRevenuePaise: { decrement: reversal.totalRevenuePaise },
          totalTransactions: { decrement: reversal.totalTransactions },
          totalItemsSold: { decrement: reversal.totalItemsSold },
          cashRevenuePaise: { decrement: reversal.cashRevenuePaise },
          upiRevenuePaise: { decrement: reversal.upiRevenuePaise },
        },
      });
      return true;
    });
    if (!removed) return notFound();

    console.log(
      JSON.stringify({ route: "POST /api/transactions/undo", event: "pos_sale_undone", vendorId: vendor.id }),
    );
    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/transactions/undo POST]", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
