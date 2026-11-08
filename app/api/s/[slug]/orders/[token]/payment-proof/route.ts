import { NextResponse } from "next/server";

import { ImageUploadError, readImageUpload } from "@/lib/blob-image";
import { deletePaymentProofInBackground, paymentProofToken, putPaymentProof } from "@/lib/payment-proof";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Buyer attaches a screenshot of their UPI payment to an order they have
 * already said "I've paid" for (POST …/utr first). multipart/form-data, field
 * `file` → { success: true }.
 *
 * Public, keyed on the 192-bit order token plus the storefront gate, like /utr.
 * It only attaches evidence for the seller: it never records a claim, never
 * marks the order paid and never extends a stock hold — an order without a
 * claim gets 409 `not_awaiting_payment`. A new upload replaces the old one.
 *
 * The image is PII (name, UPI ID, UTR): private Blob store, never logged,
 * never echoed back. No store configured → 503. Rules: lib/payment-proof.ts.
 */

const proofRateLimit = makeLimiter({
  name: "storefront-payment-proof",
  windowMs: 60_000,
  max: 5,
});

const awaitingSellerWhere = {
  paymentMethod: "UPI",
  paymentStatus: "PENDING",
  fulfilmentStatus: { not: "CANCELLED" },
  paymentClaimedAt: { not: null },
} as const;

export async function POST(req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
  try {
    const rl = await proofRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-payment-proof");

    const token = paymentProofToken();
    if (!token) return NextResponse.json({ error: "Screenshot uploads are not set up" }, { status: 503 });

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
        paymentMethod: true,
        paymentStatus: true,
        fulfilmentStatus: true,
        paymentClaimedAt: true,
        paymentProofUrl: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Cheap pre-check so a stale page doesn't pay for an upload we'd discard.
    const awaiting =
      order.paymentMethod === "UPI" &&
      order.paymentStatus === "PENDING" &&
      order.fulfilmentStatus !== "CANCELLED" &&
      order.paymentClaimedAt !== null;
    if (!awaiting) return NextResponse.json({ error: "not_awaiting_payment" }, { status: 409 });

    // Validated before touching Blob storage — never pay for an upload we reject.
    const { file, ext } = await readImageUpload(req);
    const url = await putPaymentProof({ vendorId: order.vendorId, file, ext, token });

    // Eligibility again in the compound where: the seller may have answered
    // (paid / not received / cancelled) while the upload was in flight. Pinning
    // the URL we read means two uploads racing can't orphan a blob: the loser's
    // is deleted, and the one replaced is always the one we read.
    const res = await prisma.transaction.updateMany({
      where: { id: order.id, vendorId: order.vendorId, paymentProofUrl: order.paymentProofUrl, ...awaitingSellerWhere },
      data: { paymentProofUrl: url },
    });
    if (res.count === 0) {
      deletePaymentProofInBackground(url);
      return NextResponse.json({ error: "not_awaiting_payment" }, { status: 409 });
    }
    deletePaymentProofInBackground(order.paymentProofUrl);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ImageUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(
      JSON.stringify({
        event: "storefront_payment_proof_failed",
        slug: params.slug,
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
