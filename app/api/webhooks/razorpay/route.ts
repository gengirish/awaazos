import { NextRequest, NextResponse } from "next/server";

import { toSubscriptionSnapshot, verifyRazorpaySignature } from "@/lib/razorpay";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";
import { isSubscriptionEvent } from "@/lib/subscription";
import { recordSubscriptionEvent } from "@/lib/subscription-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Platform SaaS subscription webhook (AwaazOS's own Razorpay account).
 * State transitions live in lib/subscription.ts and the write (ledger + vendor,
 * one transaction) in lib/subscription-store.ts; this route only verifies and
 * parses. See docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md.
 *
 * Idempotency: every delivery is recorded keyed on the `x-razorpay-event-id`
 * header. A replay is acknowledged without effect, so a DB failure can safely
 * return 500 and let Razorpay retry.
 */

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function entityOf(payload: Obj | null, key: string): Obj | null {
  return obj(obj(payload?.[key])?.entity);
}

function maskId(id: string | null | undefined): string {
  if (!id) return "?";
  return id.length <= 4 ? "****" : `…${id.slice(-4)}`;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await webhookRateLimit.check(`razorpay:${ip}`);
  if (!rl.ok) {
    return tooManyRequests(rl, "webhook-razorpay");
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature");
  if (!verifyRazorpaySignature(rawBody, sig)) {
    return NextResponse.json({}, { status: 401 });
  }

  let body: Obj | null;
  try {
    body = obj(JSON.parse(rawBody));
  } catch {
    body = null;
  }
  if (!body) {
    console.warn("[webhooks/razorpay] invalid json");
    return NextResponse.json({ ok: true });
  }

  const event = str(body.event) ?? "";
  if (!isSubscriptionEvent(event)) {
    return NextResponse.json({ ok: true });
  }

  const payload = obj(body.payload);
  const entity = entityOf(payload, "subscription");
  const subId = str(entity?.id);
  if (!entity || !subId) {
    console.warn("[webhooks/razorpay] %s without subscription entity", event);
    return NextResponse.json({ ok: true });
  }

  // Razorpay sends the event id as a header, not in the body. Fall back to a
  // key built from the signed body so a missing header still dedupes.
  const eventId =
    str(req.headers.get("x-razorpay-event-id")) ??
    `nohdr:${event}:${subId}:${String(body.created_at ?? "")}`;

  const planId = str(entity.plan_id) ?? "";
  const sub = toSubscriptionSnapshot(subId, entity);

  const payment = entityOf(payload, "payment");
  const paymentId = str(payment?.id);
  const amountPaise =
    typeof payment?.amount === "number" && Number.isInteger(payment.amount) ? payment.amount : null;

  const notes = obj(entity.notes);
  const notedVendorId = str(notes?.vendorId) ?? str(notes?.vendor_id);

  console.info(
    "[webhooks/razorpay] event=%s id=%s sub=%s",
    event,
    maskId(eventId),
    maskId(subId),
  );
  if (!sub.mapped && (event === "subscription.activated" || event === "subscription.charged")) {
    console.warn("[webhooks/razorpay] %s: unknown plan_id %s", event, maskId(planId));
  }

  try {
    const result = await recordSubscriptionEvent({
      eventId,
      event,
      sub,
      vendorId: notedVendorId,
      paymentId,
      amountPaise,
    });
    if (result.kind === "duplicate") {
      console.info("[webhooks/razorpay] duplicate event %s ignored", maskId(eventId));
    } else if (result.kind === "no_vendor") {
      console.warn("[webhooks/razorpay] %s: no vendor for sub %s", event, maskId(subId));
    }
  } catch (e) {
    console.error(
      "[webhooks/razorpay] handler error event=%s: %s",
      event,
      e instanceof Error ? e.message : "unknown",
    );
    // Safe to retry: the ledger insert rolled back with everything else.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
