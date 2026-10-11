import { Plan } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getReceiptQueue } from "@/lib/queues";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";
import { withTimeout } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    transactionId: z.string().min(1).optional(),
    billNumber: z.string().min(1).optional(),
    customerPhone: z.string().optional(),
  })
  .refine((b) => Boolean(b.transactionId || b.billNumber), {
    message: "Either transactionId or billNumber is required",
    path: ["transactionId"],
  });

const jobOpts = {
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

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    requirePlan(ctx.vendor, Plan.STARTER);

    const settings = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
    });
    const wa = settings?.whatsappNumber?.trim();
    if (!wa) {
      return NextResponse.json({ error: "WhatsApp not configured", code: "whatsapp_not_configured" }, { status: 400 });
    }

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

    // Vendor-scoped lookup defeats ID forgery for both identifiers — a staff
    // member of vendor A cannot resend vendor B's receipt by guessing either
    // a transactionId or a billNumber.
    const where = parsed.data.transactionId
      ? { id: parsed.data.transactionId, vendorId: ctx.vendor.id }
      : { billNumber: parsed.data.billNumber!, vendorId: ctx.vendor.id };

    const transaction = await prisma.transaction.findFirst({
      where,
      include: { receipt: true },
    });

    if (!transaction?.receipt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const dest =
      parsed.data.customerPhone?.trim() || transaction.customerPhone?.trim() || "";
    if (!dest) {
      return NextResponse.json({ error: "Missing customer phone", code: "missing_customer_phone" }, { status: 400 });
    }

    try {
      // Bounded: with REDIS_URL set but Redis unreachable, add() never settles.
      await withTimeout(
        getReceiptQueue().add(
          "send-receipt",
          {
            transactionId: transaction.id,
            vendorId: ctx.vendor.id,
            customerPhone: dest,
          },
          jobOpts,
        ),
        2_000,
        "receipt.enqueue",
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          route: "POST /api/receipts/send",
          event: "enqueue_failed",
          vendorId: ctx.vendor.id,
          transactionId: transaction.id,
          message: e instanceof Error ? e.message : "unknown",
        }),
      );
      return NextResponse.json({ error: "Queue unavailable", code: "queue_unavailable" }, { status: 503 });
    }

    const res = NextResponse.json({ queued: true }, { status: 202 });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof PlanGateError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "plan_upgrade_required",
          requiredPlan: err.required,
          currentPlan: err.current,
          feature: "whatsapp_receipts",
        },
        { status: err.status },
      );
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.message }, { status: err.status });
    }
    console.error("[api/receipts/send]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
