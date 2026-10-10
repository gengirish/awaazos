import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { fromUnixSeconds, planFromRazorpayPlanId, verifyRazorpaySignature } from "@/lib/razorpay";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";
import {
  applySubscriptionEvent,
  isSubscriptionEvent,
  type SubscriptionSnapshot,
} from "@/lib/subscription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Platform SaaS subscription webhook (AwaazOS's own Razorpay account).
 * State transitions live in lib/subscription.ts; this route only verifies,
 * dedupes and writes. See docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md.
 *
 * Idempotency: every delivery is recorded in `SubscriptionEvent` keyed on the
 * `x-razorpay-event-id` header, in the same transaction as the vendor update.
 * A replay hits the unique index (P2002) and is acknowledged without effect,
 * so a DB failure can safely return 500 and let Razorpay retry.
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
  const sub: SubscriptionSnapshot = {
    id: subId,
    status: str(entity.status) ?? "unknown",
    mapped: planFromRazorpayPlanId(planId),
    currentEnd: fromUnixSeconds(entity.current_end),
    startAt: fromUnixSeconds(entity.start_at),
    paidCount: typeof entity.paid_count === "number" ? entity.paid_count : null,
  };

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
    await prisma.$transaction(async (tx) => {
      let vendorId = notedVendorId;
      if (!vendorId) {
        const row = await tx.vendorSettings.findFirst({
          where: { razorpaySubId: subId },
          select: { vendorId: true },
        });
        vendorId = row?.vendorId ?? null;
      }

      // Serialise deliveries for one vendor so two events can't both read the
      // old planExpiresAt. Also confirms the vendor still exists.
      const locked = vendorId
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM vendors WHERE id = ${vendorId} FOR UPDATE`
        : [];
      if (locked.length === 0) vendorId = null;

      await tx.subscriptionEvent.create({
        data: {
          vendorId,
          razorpayEventId: eventId,
          event,
          subscriptionId: subId,
          paymentId,
          amountPaise,
          status: sub.status,
          currentEnd: sub.currentEnd,
        },
      });

      if (!vendorId) {
        console.warn("[webhooks/razorpay] %s: no vendor for sub %s", event, maskId(subId));
        return;
      }

      const vendor = await tx.vendor.findUniqueOrThrow({
        where: { id: vendorId },
        select: { plan: true, planExpiresAt: true, settings: { select: { razorpaySubId: true } } },
      });
      const patch = applySubscriptionEvent(
        {
          plan: vendor.plan,
          planExpiresAt: vendor.planExpiresAt,
          razorpaySubId: vendor.settings?.razorpaySubId ?? null,
        },
        event,
        sub,
      );

      if (patch.vendor) {
        await tx.vendor.update({ where: { id: vendorId }, data: patch.vendor });
      }
      if (patch.settings) {
        await tx.vendorSettings.upsert({
          where: { vendorId },
          create: { vendorId, ...patch.settings },
          update: patch.settings,
        });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      console.info("[webhooks/razorpay] duplicate event %s ignored", maskId(eventId));
      return NextResponse.json({ ok: true });
    }
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
