import { NextResponse } from "next/server";
import { z } from "zod";

import { markOrderPaid } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import {
  findStorefrontOrderForPayment,
  getVendorRazorpayCreds,
  verifyCheckoutSignature,
} from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Razorpay Checkout success callback for a storefront order.
 *
 * The buyer's browser relays `{ razorpay_order_id, razorpay_payment_id,
 * razorpay_signature }`. The signature is HMAC-SHA256(order|payment) with the
 * VENDOR's key secret, so only Razorpay could have produced it. It is verified
 * before any write, and the order id must be the one we created for this
 * transaction — a valid signature for some other order of the same vendor is
 * rejected. Then `markOrderPaid` (idempotent; credits DailySummary once).
 *
 * The per-vendor webhook (app/api/webhooks/razorpay-orders/[vendorId]) does the
 * same independently, so a buyer closing the tab mid-redirect still gets paid.
 * Signatures and ids are never logged.
 */

const verifyRateLimit = makeLimiter({
  name: "storefront-rzp-verify",
  windowMs: 60_000,
  max: 20,
});

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const bodySchema = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
  razorpay_signature: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

function err(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request, { params }: { params: { slug: string; token: string } }) {
  try {
    const rl = await verifyRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-rzp-verify");
    if (!TOKEN_RE.test(params.token)) return err("Not found", 404);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body", 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return err("invalid_input", 400);
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
      parsed.data;

    const order = await findStorefrontOrderForPayment(params.slug, params.token);
    if (!order) return err("Not found", 404);

    const creds = await getVendorRazorpayCreds(order.vendorId);
    if (!creds) return err("online_payment_unavailable", 409);

    if (!verifyCheckoutSignature(orderId, paymentId, signature, creds.keySecret)) {
      return err("invalid_signature", 400);
    }
    if (!order.razorpayOrderId || order.razorpayOrderId !== orderId) {
      return err("order_mismatch", 400);
    }

    if (order.paymentStatus === "PAID") {
      return NextResponse.json({ data: { paid: true } });
    }

    const marked = await prisma.$transaction((tx) =>
      markOrderPaid(tx, {
        vendorId: order.vendorId,
        transactionId: order.id,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
      }),
    );
    if (marked) {
      console.info(
        JSON.stringify({ event: "storefront_rzp_paid", via: "checkout", vendorId: order.vendorId, transactionId: order.id }),
      );
      return NextResponse.json({ data: { paid: true } });
    }

    // Lost a race with the webhook (fine) — or the order was cancelled while the
    // buyer was paying, in which case the vendor must refund from her dashboard.
    const current = await prisma.transaction.findFirst({
      where: { id: order.id, vendorId: order.vendorId },
      select: { paymentStatus: true },
    });
    if (current?.paymentStatus === "PAID") return NextResponse.json({ data: { paid: true } });
    console.warn(
      JSON.stringify({
        event: "storefront_rzp_paid_unapplied",
        via: "checkout",
        vendorId: order.vendorId,
        transactionId: order.id,
      }),
    );
    return err("not_awaiting_payment", 409);
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "storefront_rzp_verify_failed",
        slug: params.slug,
        error: e instanceof Error ? e.name : "unknown",
        code: (e as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return err("Internal server error", 500);
  }
}
