import { NextResponse } from "next/server";

import { markOrderPaid } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";
import { decryptSecret, SecretBoxKeyInvalidError, SecretBoxKeyMissingError } from "@/lib/secret-box";
import { verifyWebhookSignature, webhookSecretAad } from "@/lib/storefront-razorpay";

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
 * Never logs the body, signature, secret, or any customer field.
 *
 * Excluded from middleware by the `api/webhooks` matcher in middleware.ts.
 */

const VENDOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY_BYTES = 256 * 1024;
const HANDLED_EVENTS = new Set(["payment.captured", "order.paid"]);

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

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
  let body: Json | null;
  try {
    body = obj(JSON.parse(rawBody));
  } catch {
    body = null;
  }
  if (!body) return ack();

  const event = str(body.event) ?? "";
  if (!HANDLED_EVENTS.has(event)) return ack();

  const payload = obj(body.payload);
  const payment = obj(obj(payload?.payment)?.entity);
  const rzOrder = obj(obj(payload?.order)?.entity);

  const razorpayOrderId = str(payment?.order_id) ?? str(rzOrder?.id);
  const razorpayPaymentId = str(payment?.id);
  if (!razorpayOrderId) return ack();

  // Amount actually paid, in paise.
  const amountPaid = int(payment?.amount) ?? int(rzOrder?.amount_paid);
  const currency = str(payment?.currency) ?? str(rzOrder?.currency) ?? "INR";
  // Our notes live on the order; payment notes only carry Checkout's own.
  const notesTxnId = str(obj(rzOrder?.notes)?.transactionId) ?? str(obj(payment?.notes)?.transactionId);

  try {
    const txn = await prisma.transaction.findFirst({
      where: { razorpayOrderId, vendorId, source: "STOREFRONT" },
      select: { id: true, totalPaise: true, paymentStatus: true },
    });
    if (!txn) {
      console.warn(JSON.stringify({ event: "webhook_rzp_orders_unmatched", vendorId, rzEvent: event }));
      return ack();
    }
    if (
      (notesTxnId && notesTxnId !== txn.id) ||
      amountPaid === null ||
      amountPaid !== txn.totalPaise ||
      currency !== "INR"
    ) {
      console.warn(
        JSON.stringify({
          event: "webhook_rzp_orders_mismatch",
          vendorId,
          transactionId: txn.id,
          rzEvent: event,
          notesMatch: !notesTxnId || notesTxnId === txn.id,
          amountMatch: amountPaid === txn.totalPaise,
          currencyMatch: currency === "INR",
        }),
      );
      return ack();
    }
    if (txn.paymentStatus === "PAID") return ack();

    const marked = await prisma.$transaction((tx) =>
      markOrderPaid(tx, {
        vendorId,
        transactionId: txn.id,
        razorpayOrderId,
        razorpayPaymentId,
      }),
    );
    console.info(
      JSON.stringify({
        event: marked ? "storefront_rzp_paid" : "storefront_rzp_paid_unapplied",
        via: "webhook",
        rzEvent: event,
        vendorId,
        transactionId: txn.id,
      }),
    );
    return ack();
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "webhook_rzp_orders_failed",
        vendorId,
        error: e instanceof Error ? e.name : "unknown",
        code: (e as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
