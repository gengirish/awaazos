import { NextResponse } from "next/server";

import { PENDING_HOLD_MINUTES } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { notifyVendorInBackground, paymentSubmittedPayload } from "@/lib/push";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import { utrSubmitSchema } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Buyer says "I've paid" for a storefront order, with or without the UPI
 * reference (UTR). The path is still /utr: order pages already open in a
 * buyer's browser post here.
 *
 * Public, keyed on the 192-bit order token plus the storefront gate (active
 * vendor, publishStorefront). This only *records* the claim (paymentClaimedAt,
 * plus the UTR when given) — it never marks the order paid. The vendor checks
 * their bank app and answers "Payment received" or "Not received"; a buyer
 * tapping a button must not be able to self-certify payment.
 *
 * After a "Not received" (paymentRejectedAt) a bare tap is not enough any more:
 * the next claim needs a UTR, so the hold can't be renewed by tapping again.
 *
 * The UTR is PII (CLAUDE.md): never logged, never echoed back.
 */

const utrRateLimit = makeLimiter({
  name: "storefront-utr",
  windowMs: 60_000,
  max: 10,
});

export async function POST(req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
  try {
    const rl = await utrRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-utr");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = utrSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const order = await prisma.transaction.findFirst({
      where: {
        orderToken: params.token,
        source: "STOREFRONT",
        vendor: {
          slug: params.slug,
          isActive: true,
          settings: { is: { publishStorefront: true } },
        },
      },
      select: {
        id: true,
        vendorId: true,
        billNumber: true,
        totalPaise: true,
        dropId: true,
        paymentRejectedAt: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const upiRef = parsed.data.upiRef;
    if (order.paymentRejectedAt && !upiRef) {
      return NextResponse.json({ error: "reference_required" }, { status: 400 });
    }

    // Eligibility lives in the compound where, so a concurrent vendor action
    // (mark paid / cancel) between the read and the write cannot be overwritten.
    const res = await prisma.transaction.updateMany({
      where: {
        id: order.id,
        vendorId: order.vendorId,
        paymentMethod: "UPI",
        paymentStatus: "PENDING",
        fulfilmentStatus: { not: "CANCELLED" },
        // Only while the order still holds its stock (or already has a claim,
        // e.g. the buyer adding a UTR to it). A claim on a lapsed hold would
        // re-reserve items that may since have sold to someone else — the order
        // page tells the buyer to message the kitchen instead.
        OR: [
          { createdAt: { gt: new Date(Date.now() - PENDING_HOLD_MINUTES * 60_000) } },
          { upiRef: { not: null } },
          { paymentClaimedAt: { not: null } },
        ],
      },
      data: { paymentClaimedAt: new Date(), ...(upiRef ? { upiRef } : {}) },
    });
    if (res.count === 0) {
      return NextResponse.json({ error: "not_awaiting_payment" }, { status: 409 });
    }

    // Tell the vendor's phones there's a payment to check (no buyer PII, no UTR).
    notifyVendorInBackground(
      order.vendorId,
      paymentSubmittedPayload({ billNumber: order.billNumber, totalPaise: order.totalPaise, dropId: order.dropId }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_utr_failed",
        slug: params.slug,
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
