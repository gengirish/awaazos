import { Prisma, type PaymentMethod, type PaymentStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getIstTodayStart, formatBillDateYYYYMMDD } from "@/lib/billing-period";
import { PLAN_LIMITS } from "@/lib/constants";
import { countBillableTxnThisMonth } from "@/lib/drops";
import { beginIdempotency, getIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getReceiptQueue } from "@/lib/queues";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { parseTransactionListQuery } from "@/lib/transaction-list-params";
import {
  checkTransactionTotals,
  resolveSaleTime,
  transactionPostBodySchema,
  type TransactionPostBody,
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

type TransactionResponseBody = {
  transaction: {
    id: string;
    billNumber: string;
    totalPaise: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    createdAt: Date;
    paidAt: Date | null;
  };
  receiptNumber: string;
  whatsappQueued: boolean;
};

function toResponseBody(
  t: TransactionResponseBody["transaction"],
  whatsappQueued: boolean,
): TransactionResponseBody {
  return {
    transaction: {
      id: t.id,
      billNumber: t.billNumber,
      totalPaise: t.totalPaise,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      createdAt: t.createdAt,
      paidAt: t.paidAt,
    },
    receiptNumber: t.billNumber,
    whatsappQueued,
  };
}

/** A committed sale for this outbox entry, if any (replays get it back with 200). */
async function findByClientRef(vendorId: string, clientRef: string) {
  return prisma.transaction.findUnique({
    where: { vendorId_clientRef: { vendorId, clientRef } },
    select: {
      id: true,
      billNumber: true,
      totalPaise: true,
      paymentMethod: true,
      paymentStatus: true,
      createdAt: true,
      paidAt: true,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendor = ctx.vendor;

    const rl = await writeRateLimit.check(vendor.id);
    if (!rl.ok) return tooManyRequests(rl, "transactions-write");

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

    // A queued sale names the tenant it was rung up for. requireVendorRole falls
    // back to the user's first membership when ?vendor= doesn't match, so never
    // let that fallback file the sale under a different vendor.
    if (body.vendorId && body.vendorId !== vendor.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.clientRef) {
      const existing = await findByClientRef(vendor.id, body.clientRef);
      if (existing) {
        const res = NextResponse.json(toResponseBody(existing, false), { status: 200 });
        return withVendorCookie(res, ctx.setVendorCookie);
      }
    }

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

    const totals = checkTransactionTotals(body);
    if (!totals.ok) {
      return NextResponse.json({ error: totals.code, code: totals.code }, { status: 400 });
    }

    const saleTime = resolveSaleTime(body);
    if (!saleTime.ok) {
      return NextResponse.json({ error: saleTime.code, code: saleTime.code }, { status: 422 });
    }
    const { saleAt, fromClient } = saleTime;

    const cap = PLAN_LIMITS[vendor.plan].monthlyTxnCap;
    if (cap !== null) {
      // Unpaid storefront pre-orders don't burn the cap (lib/drops.ts).
      const count = await countBillableTxnThisMonth(prisma, vendor.id);
      if (count >= cap) {
        if (!body.deferred) {
          throw new AuthError(402, "monthly_txn_cap_reached");
        }
        // The money already changed hands offline, so the record is kept
        // (docs/PWA_OFFLINE_PLAN.md D3). Live checkouts stay blocked.
        console.warn(
          JSON.stringify({
            route: "POST /api/transactions",
            event: "offline_sale_over_cap",
            vendorId: vendor.id,
          }),
        );
      }
    }

    // The IST day the sale happened: today for a live checkout, the device's day
    // for a deferred one. Bill number, BillSequence and DailySummary all follow it.
    const today = getIstTodayStart(saleAt);
    const paymentStatus: PaymentStatus =
      body.paymentMethod === "CASH" || (body.upiRef != null && String(body.upiRef).trim() !== "")
        ? "PAID"
        : "PENDING";
    const paidAt = paymentStatus === "PAID" ? saleAt : null;

    let transaction: Awaited<ReturnType<typeof createSale>>;
    try {
      transaction = await createSale({
        vendorId: vendor.id,
        body,
        today,
        paymentStatus,
        paidAt,
        createdAt: fromClient ? saleAt : undefined,
      });
    } catch (e) {
      // Two replays of one outbox entry raced past findByClientRef.
      if (body.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await findByClientRef(vendor.id, body.clientRef);
        if (existing) {
          const res = NextResponse.json(toResponseBody(existing, false), { status: 200 });
          return withVendorCookie(res, ctx.setVendorCookie);
        }
      }
      throw e;
    }

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

    const responseBody = toResponseBody(transaction, whatsappQueued);

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

/**
 * The single write for a counter sale: bill number → transaction + items →
 * DailySummary → receipt, all in one Postgres transaction.
 */
async function createSale(args: {
  vendorId: string;
  body: TransactionPostBody;
  today: Date;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  /** Set for deferred (offline-queued) sales; live sales use the column default. */
  createdAt?: Date;
}) {
  const { vendorId, body, today, paymentStatus, paidAt, createdAt } = args;

  return prisma.$transaction(async (tx) => {
    const seq = await tx.billSequence.upsert({
      where: { vendorId_date: { vendorId, date: today } },
      create: { vendorId, date: today, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });

    const ymd = formatBillDateYYYYMMDD(today);
    const billNumber = `AWZ-${ymd}-${String(seq.lastSeq).padStart(4, "0")}`;

    const itemsSold = body.items.reduce((s, i) => s + i.qty, 0);
    const cashInc = body.paymentMethod === "CASH" ? body.totalPaise : 0;
    const upiInc = body.paymentMethod === "UPI" ? body.totalPaise : 0;

    const transactionRow = await tx.transaction.create({
      data: {
        vendorId,
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
        clientRef: body.clientRef ?? null,
        ...(createdAt ? { createdAt } : {}),
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
    });

    await tx.dailySummary.upsert({
      where: { vendorId_date: { vendorId, date: today } },
      create: {
        vendorId,
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

    await tx.receipt.create({
      data: {
        transactionId: transactionRow.id,
        vendorId,
        receiptNumber: billNumber,
        whatsappSent: false,
      },
    });

    return transactionRow;
  });
}
