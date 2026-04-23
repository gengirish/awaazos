import { NextRequest, NextResponse } from "next/server";

import { getIstMonthStart, getIstTodayStart, formatBillDateYYYYMMDD } from "@/lib/billing-period";
import { PLAN_LIMITS } from "@/lib/constants";
import { beginIdempotency, getIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getReceiptQueue } from "@/lib/queues";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { parseTransactionListQuery } from "@/lib/transaction-list-params";
import {
  checkTransactionTotals,
  transactionPostBodySchema,
} from "@/lib/transaction-post-body";
import { listVendorTransactions } from "@/lib/transactions-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const receiptJobOpts = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

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
    const parsed = parseTransactionListQuery(req.nextUrl.searchParams);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { items, total } = await listVendorTransactions(ctx.vendor.id, parsed);

    const hasMore = parsed.page * parsed.limit < total;
    const res = NextResponse.json({
      items,
      page: parsed.page,
      limit: parsed.limit,
      total,
      hasMore,
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/transactions GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendor = ctx.vendor;

    const rl = await writeRateLimit.check(vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "transactions-write");

    const idemKey = getIdempotencyKey(req);
    let commitIdem: ((rec: { status: number; body: unknown }) => Promise<void>) | null = null;
    if (idemKey) {
      const outcome = await beginIdempotency({
        scope: "transactions-create",
        vendorId: vendor.id,
        idempotencyKey: idemKey,
      });
      if (outcome.kind === "replay") {
        return NextResponse.json(outcome.record.body, { status: outcome.record.status });
      }
      if (outcome.kind === "in_flight") {
        return NextResponse.json(
          { error: "request_in_flight", message: "Same Idempotency-Key is currently being processed." },
          { status: 409 },
        );
      }
      if (outcome.kind === "fresh") {
        commitIdem = outcome.commit;
      }
      // "disabled" → silently proceed without idempotency.
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = transactionPostBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const totals = checkTransactionTotals(body);
    if (!totals.ok) {
      return NextResponse.json({ error: totals.code, code: totals.code }, { status: 400 });
    }

    const cap = PLAN_LIMITS[vendor.plan].monthlyTxnCap;
    if (cap !== null) {
      const monthStart = getIstMonthStart();
      const count = await prisma.transaction.count({
        where: { vendorId: vendor.id, createdAt: { gte: monthStart } },
      });
      if (count >= cap) {
        throw new AuthError(402, "monthly_txn_cap_reached");
      }
    }

    const today = getIstTodayStart();
    const paymentStatus =
      body.paymentMethod === "CASH" || (body.upiRef != null && String(body.upiRef).trim() !== "")
        ? "PAID"
        : "PENDING";
    const paidAt = paymentStatus === "PAID" ? new Date() : null;

    const { transaction, receipt } = await prisma.$transaction(async (tx) => {
      const seq = await tx.billSequence.upsert({
        where: { vendorId_date: { vendorId: vendor.id, date: today } },
        create: { vendorId: vendor.id, date: today, lastSeq: 1 },
        update: { lastSeq: { increment: 1 } },
      });

      const ymd = formatBillDateYYYYMMDD(today);
      const billNumber = `AWZ-${ymd}-${String(seq.lastSeq).padStart(4, "0")}`;

      const itemsSold = body.items.reduce((s, i) => s + i.qty, 0);
      const cashInc = body.paymentMethod === "CASH" ? body.totalPaise : 0;
      const upiInc = body.paymentMethod === "UPI" ? body.totalPaise : 0;

      const transactionRow = await tx.transaction.create({
        data: {
          vendorId: vendor.id,
          billNumber,
          subtotalPaise: body.subtotalPaise,
          discountPaise: body.discountPaise,
          taxPaise: body.taxPaise,
          totalPaise: body.totalPaise,
          paymentMethod: body.paymentMethod,
          paymentStatus,
          upiRef: body.upiRef?.trim() || null,
          customerPhone: body.customerPhone?.trim() || null,
          customerName: body.customerName?.trim() || null,
          voiceTranscript: body.voiceTranscript ?? null,
          source: body.source,
          notes: body.notes?.trim() || null,
          paidAt,
          orderItems: {
            create: body.items.map((i) => ({
              menuItemId: i.menuItemId ?? null,
              name: i.name,
              priceInPaise: i.priceInPaise,
              qty: i.qty,
              totalPaise: i.priceInPaise * i.qty,
            })),
          },
        },
        include: { orderItems: true },
      });

      await tx.dailySummary.upsert({
        where: { vendorId_date: { vendorId: vendor.id, date: today } },
        create: {
          vendorId: vendor.id,
          date: today,
          totalRevenuePaise: body.totalPaise,
          totalTransactions: 1,
          totalItemsSold: itemsSold,
          cashRevenuePaise: cashInc,
          upiRevenuePaise: upiInc,
        },
        update: {
          totalRevenuePaise: { increment: body.totalPaise },
          totalTransactions: { increment: 1 },
          totalItemsSold: { increment: itemsSold },
          cashRevenuePaise: { increment: cashInc },
          upiRevenuePaise: { increment: upiInc },
        },
      });

      const receiptRow = await tx.receipt.create({
        data: {
          transactionId: transactionRow.id,
          vendorId: vendor.id,
          receiptNumber: billNumber,
          whatsappSent: false,
        },
      });

      return { transaction: transactionRow, receipt: receiptRow };
    });

    let whatsappQueued = false;
    const phone = body.customerPhone?.trim();
    if (phone && PLAN_LIMITS[vendor.plan].whatsapp) {
      try {
        await getReceiptQueue().add(
          "send-receipt",
          { transactionId: transaction.id, vendorId: vendor.id, customerPhone: phone },
          receiptJobOpts,
        );
        whatsappQueued = true;
      } catch (e) {
        console.error(
          JSON.stringify({
            route: "POST /api/transactions",
            event: "receipt_enqueue_failed",
            vendorId: vendor.id,
            transactionId: transaction.id,
            message: e instanceof Error ? e.message : "unknown",
          }),
        );
      }
    }

    const responseBody = {
      transaction: {
        id: transaction.id,
        billNumber: transaction.billNumber,
        totalPaise: transaction.totalPaise,
        paymentMethod: transaction.paymentMethod,
        paymentStatus: transaction.paymentStatus,
        createdAt: transaction.createdAt,
        paidAt: transaction.paidAt,
      },
      receiptNumber: receipt.receiptNumber,
      whatsappQueued,
    };

    if (commitIdem) {
      await commitIdem({ status: 201, body: responseBody });
    }

    const res = NextResponse.json(responseBody, { status: 201 });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/transactions POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
