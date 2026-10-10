import { Plan } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { istDayRangeFromQuery } from "@/lib/billing-period";
import { paiseToRupees } from "@/lib/currency";
import { formatIstDate } from "@/lib/datetime";
import { withStatementTimeout } from "@/lib/db-timeout";
import { lastFourDigits } from "@/lib/phone";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvPlainInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

function maskCustomerPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return `XXXXXX${lastFourDigits(phone)}`;
}

function csvEscape(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function formatIstTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    // A locked vendor (trial over, not subscribed) can always take their own
    // records out, whatever the plan gate says.
    if (ctx.access.kind !== "locked") requirePlan(ctx.vendor, Plan.STARTER);

    const sp = req.nextUrl.searchParams;
    const fromStr = sp.get("from");
    const toStr = sp.get("to");
    if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
    }

    const { from, to } = istDayRangeFromQuery(fromStr, toStr);
    if (!from || !to) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const rows = await withStatementTimeout(8_000, (tx) =>
      tx.transaction.findMany({
        where: {
          vendorId: ctx.vendor.id,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
        include: { orderItems: true },
      }),
    );

    const lines: string[] = [
      "Bill#,Date,Time,Items,Subtotal,Discount,Tax,Total,Method,Status,Customer Phone (last 4),UPI Ref",
    ];

    for (const r of rows) {
      const itemCount = r.orderItems.reduce((s, o) => s + o.qty, 0);
      const row = [
        csvEscape(r.billNumber),
        csvEscape(formatIstDate(r.createdAt)),
        csvEscape(formatIstTime(r.createdAt)),
        csvEscape(String(itemCount)),
        csvEscape(csvPlainInr(r.subtotalPaise)),
        csvEscape(csvPlainInr(r.discountPaise)),
        csvEscape(csvPlainInr(r.taxPaise)),
        csvEscape(csvPlainInr(r.totalPaise)),
        csvEscape(r.paymentMethod),
        csvEscape(r.paymentStatus),
        csvEscape(maskCustomerPhone(r.customerPhone)),
        csvEscape(r.upiRef ?? ""),
      ].join(",");
      lines.push(row);
    }

    const csv = lines.join("\n") + "\n";
    const filename = `awaazos-${ctx.vendor.slug}-${fromStr}-${toStr}.csv`;

    const res = new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof PlanGateError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: "csv_export",
        },
        { status: err.status },
      );
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/transactions/export]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
