import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";
import { decryptSecret, SecretBoxKeyInvalidError, SecretBoxKeyMissingError } from "@/lib/secret-box";
import { verifyWebhookSignature, webhookSecretAad } from "@/lib/storefront-razorpay";
import { applyRazorpayPaymentEvent, parseWebhookBody } from "@/lib/storefront-razorpay-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-vendor Razorpay webhook for storefront payments.
 *
 * Each vendor registers `/api/webhooks/razorpay-orders/<vendorId>` in HER OWN
 * Razorpay dashboard with her own webhook secret (events: payment.captured,
 * order.paid). The path picks which secret to verify against.
 *
 * HMAC before DB: the only read before verification is the vendor's encrypted
 * webhook secret (a single-column select — unavoidable, the secret is per
 * vendor). Nothing else is touched until the signature checks out. An unknown
 * vendor and a bad signature are indistinguishable (both 400).
 *
 * After verification: 200 for anything irrelevant or unmatched (Razorpay must
 * stop retrying), 500 only for our own failures (so Razorpay retries).
 * Never logs the body, signature, secret, or any customer field. The
 * post-verification handling is shared with the partner webhook
 * (lib/storefront-razorpay-webhook.ts).
 *
 * Excluded from middleware by the `api/webhooks` matcher in middleware.ts.
 */

const VENDOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY_BYTES = 256 * 1024;

function badSignature() {
  return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
}
function ack() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, props: { params: Promise<{ vendorId: string }> }) {
  const params = await props.params;
  const rl = await webhookRateLimit.check(`razorpay-orders:${getClientIp(req)}`);
  if (!rl.ok) return tooManyRequests(rl, "webhook-razorpay-orders");

  const vendorId = params.vendorId;
  const signature = req.headers.get("x-razorpay-signature");
  if (!VENDOR_ID_RE.test(vendorId) || !signature) return badSignature();

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return badSignature();

  // ── The one pre-verification read: this vendor's encrypted webhook secret. ──
  let secret: string;
  try {
    const row = await prisma.vendorSettings.findUnique({
      where: { vendorId },
      select: { razorpayWebhookSecretEnc: true },
    });
    if (!row?.razorpayWebhookSecretEnc) return badSignature();
    secret = decryptSecret(row.razorpayWebhookSecretEnc, webhookSecretAad(vendorId));
  } catch (e) {
    const misconfigured = e instanceof SecretBoxKeyMissingError || e instanceof SecretBoxKeyInvalidError;
    console.error(
      JSON.stringify({
        event: "webhook_rzp_orders_secret_unavailable",
        vendorId,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
    // Our fault, not Razorpay's: non-2xx so it retries once we're fixed.
    return NextResponse.json({ error: "unavailable" }, { status: misconfigured ? 503 : 500 });
  }

  if (!verifyWebhookSignature(rawBody, signature, secret)) return badSignature();

  // ── Verified. ──
  const body = parseWebhookBody(rawBody);
  if (!body) return ack();
  const outcome = await applyRazorpayPaymentEvent(body, { kind: "vendor", vendorId }, "webhook");
  return outcome === "ack" ? ack() : NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
