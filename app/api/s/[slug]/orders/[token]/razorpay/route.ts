import { NextResponse } from "next/server";

import { PLAN_LIMITS } from "@/lib/constants";
import { orderHoldsStock } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  findStorefrontOrderForPayment,
  getVendorRazorpayCreds,
  hasStoredRazorpayCreds,
  type RazorpayCreds,
} from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Buyer starts an online payment for a storefront order.
 *
 * Public, keyed on the 192-bit order token + the storefront gate. Creates (or
 * reuses) a Razorpay Order on the VENDOR's own account for exactly the order's
 * `totalPaise` — the amount is never taken from the client. Returns only the
 * public key id; secrets never leave the server.
 *
 * Eligible only while the order is an unpaid UPI order still holding its stock,
 * and no UTR has been submitted (that would risk a double payment).
 */

const startPaymentRateLimit = makeLimiter({
  name: "storefront-rzp-order",
  windowMs: 60_000,
  max: 20,
});

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function err(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function reusableOrderId(
  creds: RazorpayCreds,
  orderId: string,
  amountPaise: number,
): Promise<{ id: string } | { paid: true } | null> {
  try {
    const o = await fetchRazorpayOrder(creds, orderId);
    if (o.status === "paid") return { paid: true };
    if (o.amount === amountPaise && o.currency === "INR") return { id: o.id };
    return null;
  } catch {
    // Unknown to these keys (e.g. vendor switched test → live) or transient:
    // a fresh order is always safe — the old one was never paid through us.
    return null;
  }
}

export async function POST(req: Request, { params }: { params: { slug: string; token: string } }) {
  try {
    const rl = await startPaymentRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-rzp-order");
    if (!TOKEN_RE.test(params.token)) return err("Not found", 404);

    const order = await findStorefrontOrderForPayment(params.slug, params.token);
    if (!order) return err("Not found", 404);

    const now = new Date();
    if (
      order.paymentMethod !== "UPI" ||
      order.paymentStatus !== "PENDING" ||
      order.fulfilmentStatus === "CANCELLED" ||
      order.upiRef
    ) {
      return err("not_awaiting_payment", 409);
    }
    if (!orderHoldsStock(order, now)) return err("order_expired", 409);

    if (!PLAN_LIMITS[order.vendor.plan].razorpayLinks || !hasStoredRazorpayCreds(order.vendor.settings)) {
      return err("online_payment_unavailable", 409);
    }
    const creds = await getVendorRazorpayCreds(order.vendorId);
    if (!creds) return err("online_payment_unavailable", 409);

    let razorpayOrderId: string | null = null;
    if (order.razorpayOrderId) {
      const reuse = await reusableOrderId(creds, order.razorpayOrderId, order.totalPaise);
      // Razorpay already captured it; the webhook / verify call will flip our row.
      if (reuse && "paid" in reuse) return err("payment_processing", 409);
      if (reuse) razorpayOrderId = reuse.id;
    }

    if (!razorpayOrderId) {
      let created;
      try {
        created = await createRazorpayOrder({
          creds,
          amountPaise: order.totalPaise,
          receipt: order.billNumber,
          notes: { transactionId: order.id, vendorId: order.vendorId },
        });
      } catch (e) {
        console.warn(
          JSON.stringify({
            event: "storefront_rzp_order_create_failed",
            vendorId: order.vendorId,
            error: e instanceof Error ? e.name : "unknown",
            status: (e as { status?: unknown } | null)?.status ?? null,
          }),
        );
        return err("razorpay_unavailable", 502);
      }

      // Compare-and-set on the id we started from: two taps racing must not
      // leave the buyer paying an order id we no longer have on file.
      const res = await prisma.transaction.updateMany({
        where: {
          id: order.id,
          vendorId: order.vendorId,
          paymentStatus: "PENDING",
          razorpayOrderId: order.razorpayOrderId,
        },
        data: { razorpayOrderId: created.id },
      });
      if (res.count === 1) {
        razorpayOrderId = created.id;
      } else {
        const current = await prisma.transaction.findFirst({
          where: { id: order.id, vendorId: order.vendorId },
          select: { razorpayOrderId: true, paymentStatus: true },
        });
        if (!current || current.paymentStatus !== "PENDING" || !current.razorpayOrderId) {
          return err("not_awaiting_payment", 409);
        }
        razorpayOrderId = current.razorpayOrderId;
      }
    }

    return NextResponse.json({
      data: {
        keyId: creds.keyId, // public by design — Checkout needs it in the browser
        razorpayOrderId,
        amountPaise: order.totalPaise,
        currency: "INR",
        name: order.vendor.name,
        billNumber: order.billNumber,
      },
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "storefront_rzp_order_failed",
        slug: params.slug,
        error: e instanceof Error ? e.name : "unknown",
        code: (e as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return err("Internal server error", 500);
  }
}
