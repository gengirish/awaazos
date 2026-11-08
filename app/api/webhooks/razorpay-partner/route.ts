import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";
import { CLEARED_OAUTH_COLUMNS, verifyWebhookSignature } from "@/lib/storefront-razorpay";
import { applyRazorpayPaymentEvent, parseWebhookBody, str } from "@/lib/storefront-razorpay-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * App-level webhook of AwaazOS's Razorpay Technology Partner app: one URL for
 * every store connected with "Connect Razorpay" (lib/razorpay-oauth.ts).
 * Events: payment.captured, order.paid, account.app.authorization_revoked.
 *
 * The secret is platform-wide (RAZORPAY_PARTNER_WEBHOOK_SECRET), so the HMAC is
 * verified BEFORE ANY database read — stricter than the per-vendor route, which
 * has to read one column first. The body's top-level `account_id` names the
 * seller's Razorpay account; an order is matched only within stores connected to
 * that account.
 *
 * 200 for anything handled, irrelevant or unmatched; 500 for our own failures
 * (Razorpay retries); 503 when the secret isn't configured. Never logs the body,
 * signature, secret or any customer field.
 *
 * Excluded from middleware by the `api/webhooks` matcher in middleware.ts.
 */

const MAX_BODY_BYTES = 256 * 1024;
const ACCOUNT_ID_RE = /^acc_[A-Za-z0-9]{6,40}$/;

function ack() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rl = await webhookRateLimit.check(`razorpay-partner:${getClientIp(req)}`);
  if (!rl.ok) return tooManyRequests(rl, "webhook-razorpay-partner");

  const secret = process.env.RAZORPAY_PARTNER_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error(JSON.stringify({ event: "webhook_rzp_partner_secret_missing" }));
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const signature = req.headers.get("x-razorpay-signature");
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES || !verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // ── Verified. ──
  const body = parseWebhookBody(rawBody);
  if (!body) return ack();
  const event = str(body.event) ?? "";
  const accountId = str(body.account_id);
  if (!accountId || !ACCOUNT_ID_RE.test(accountId)) {
    console.warn(JSON.stringify({ event: "webhook_rzp_partner_no_account", rzEvent: event }));
    return ack();
  }

  if (event === "account.app.authorization_revoked") {
    try {
      const res = await prisma.vendorSettings.updateMany({
        where: { razorpayAccountId: accountId },
        data: CLEARED_OAUTH_COLUMNS,
      });
      console.info(JSON.stringify({ event: "storefront_razorpay_revoked_by_seller", stores: res.count }));
      return ack();
    } catch (e) {
      console.error(
        JSON.stringify({ event: "webhook_rzp_partner_failed", rzEvent: event, error: e instanceof Error ? e.name : "unknown" }),
      );
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  const outcome = await applyRazorpayPaymentEvent(body, { kind: "account", accountId }, "partner_webhook");
  return outcome === "ack" ? ack() : NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
