import { NextRequest, NextResponse } from "next/server";

import { withVendorCookie } from "@/lib/drops-api";
import { getPaymentProof, paymentProofToken } from "@/lib/payment-proof";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/storefront-orders/[orderId]/payment-proof — the buyer's payment
 * screenshot, streamed from the private Blob store (lib/payment-proof.ts).
 *
 * Any storefront order of the signed-in vendor, menu or drop: it is a read, so
 * there is no frozen-drop rule and no reason to split it per route family.
 * Scoped `{ id, vendorId, source: STOREFRONT }`; another tenant's order, a
 * counter sale, no screenshot, or a blob already deleted are all 404.
 * `private, no-store`: it is PII and must not sit in a shared or disk cache.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }) {
  const params = await props.params;
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const order = await prisma.transaction.findFirst({
      where: { id: params.orderId, vendorId: ctx.vendor.id, source: "STOREFRONT" },
      select: { paymentProofUrl: true },
    });
    const token = paymentProofToken();
    if (!order?.paymentProofUrl || !token) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const proof = await getPaymentProof(order.paymentProofUrl, token);
    if (!proof) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const res = new NextResponse(proof.stream, {
      headers: {
        "Content-Type": proof.contentType,
        "Content-Length": String(proof.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(
      "[api/storefront-orders/[orderId]/payment-proof GET]",
      err instanceof Error ? err.name : "unknown error",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
