import { del, get, put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";

import { env } from "@/lib/env";

/**
 * Buyer's UPI payment screenshot ("payment proof") — server-only.
 *
 * A screenshot carries the buyer's name, UPI ID / bank and the UTR, so it is
 * PII (CLAUDE.md) and lives in a SEPARATE, PRIVATE Vercel Blob store
 * (`PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN`), never the public store that holds
 * menu photos. Its URL is useless without that token and is never sent to a
 * browser: the seller's staff see the image only through
 * `GET /api/storefront-orders/[orderId]/payment-proof` (CASHIER, compound scope).
 *
 * Lifecycle (`Transaction.paymentProofUrl`):
 *   attach   POST /api/s/[slug]/orders/[token]/payment-proof, only on an order
 *            that already has an "I've paid" claim — a screenshot never creates
 *            or renews a stock hold. A second upload replaces the first.
 *   clear    the seller answers (mark_paid / reject_payment) or cancels
 *            (lib/storefront-order-actions.ts): the column is nulled in the
 *            action's transaction and the blob deleted in the background.
 *
 * A screenshot is evidence for the seller to compare with their bank app, not
 * proof of payment: it never marks an order paid.
 *
 * Size/type rules are the shared ones in lib/blob-image.ts (4 MB, JPEG/PNG/WebP).
 */

export function paymentProofToken(): string | null {
  return env.PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN || null;
}

/** Whether buyers are offered the screenshot field at all. */
export function paymentProofEnabled(): boolean {
  return paymentProofToken() !== null;
}

export async function putPaymentProof(args: {
  vendorId: string;
  file: Blob;
  ext: string;
  token: string;
}): Promise<string> {
  // No bill number or name in the pathname: the random suffix is the only id.
  const blob = await put(`payment-proof/${args.vendorId}/proof.${args.ext}`, args.file, {
    access: "private",
    token: args.token,
    contentType: args.file.type,
    addRandomSuffix: true,
  });
  return blob.url;
}

/** Stream for the seller's viewer route, or null when the blob is gone. */
export async function getPaymentProof(url: string, token: string) {
  const res = await get(url, { access: "private", token, useCache: false });
  if (!res || res.statusCode !== 200) return null;
  return { stream: res.stream, contentType: res.blob.contentType, size: res.blob.size };
}

/**
 * Deletes a screenshot without blocking or failing the caller. Housekeeping:
 * the row no longer points at it. If the surrounding transaction rolls back
 * afterwards, the row keeps a URL to a deleted blob and the viewer answers
 * 404 — harmless, and rarer than leaving PII behind.
 */
export function deletePaymentProofInBackground(url: string | null | undefined): void {
  const token = paymentProofToken();
  if (!url || !token) return;
  const p = del(url, { token }).catch((e: unknown) => {
    console.error(
      JSON.stringify({ event: "payment_proof_delete_failed", error: e instanceof Error ? e.name : "unknown" }),
    );
  });
  try {
    waitUntil(p);
  } catch {
    // Outside a Vercel request context the promise still runs to completion.
  }
}
