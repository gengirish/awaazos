import { NextResponse } from "next/server";
import { z } from "zod";

import { markOrderPaid } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import {
  fetchRazorpayOrder,
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
 * razorpay_signature }`. The order id must be the one we created for this
 * transaction. With pasted keys the signature is HMAC-SHA256(order|payment) with
 * the VENDOR's key secret, so only Razorpay could have produced it. With "Connect
 * Razorpay" (OAuth) we hold no secret that signs it, so instead the order is
 * fetched from Razorpay as the vendor and must be `paid` for the full amount.
 * Both checks run before any write. Then `markOrderPaid` (idempotent; credits
 * DailySummary once).
 *
 * The webhooks (per-vendor app/api/webhooks/razorpay-orders/[vendorId], or the
 * partner app/api/webhooks/razorpay-partner for connected stores) do the same
 * independently, so a buyer closing the tab mid-redirect still gets paid.
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

export async function POST(req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
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

    if (!order.razorpayOrderId || order.razorpayOrderId !== orderId) {
      return err("order_mismatch", 400);
    }
    if (creds.kind === "keys") {
      if (!verifyCheckoutSignature(orderId, paymentId, signature, creds.keySecret)) {
        return err("invalid_signature", 400);
      }
    } else {
      // "Connect Razorpay": no key secret of ours signs Checkout, so Razorpay's own
      // record is the proof — the order must be paid in full, as the seller.
      let rz;
      try {
        rz = await fetchRazorpayOrder(creds, orderId);
      } catch {
        return err("razorpay_unavailable", 502);
      }
      if (rz.status !== "paid" || rz.amount_paid !== order.totalPaise || rz.currency !== "INR") {
        return err("not_paid_yet", 409);
      }
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
