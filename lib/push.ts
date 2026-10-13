/**
 * Web Push — new-order alerts on vendors' phones, even with the screen locked.
 *
 * Event-driven: sent only when a storefront order lands or a buyer submits a
 * UPI reference. Nothing here runs on a timer, so it costs Neon nothing while
 * idle (unlike polling the orders board).
 *
 * Rules:
 *   - Feature-gated: without VAPID env every call is a silent no-op.
 *   - Recipients are the vendor's ACTIVE staff who opted in on a device.
 *   - Payloads carry no buyer PII (lock screens are public): bill number,
 *     amount and item count only. Tapping opens the right board.
 *   - A 404/410 from the push service means the subscription is dead → delete.
 *     Repeated other failures (MAX_FAILURES) also delete. No cleanup job.
 *   - Never log endpoints or keys — the endpoint is effectively a credential.
 *   - Sending never blocks the request: `notifyVendorInBackground` hands the
 *     promise to Vercel's `waitUntil` so it survives the response.
 */

import { waitUntil } from "@vercel/functions";
import webpush from "web-push";

import { formatINR } from "@/lib/currency";
import { dropOrdersHref } from "@/lib/drops-board";
import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  body: string;
  /** Same-origin path opened when the notification is tapped. */
  url: string;
  /** Same tag replaces instead of stacking (one notification per order/event). */
  tag: string;
};

const MAX_FAILURES = 5;
const SEND_TIMEOUT_MS = 5_000;
/** Seconds a push service keeps an undelivered alert (phone offline). */
const TTL_SECONDS = 60 * 60;

let configured: boolean | null = null;

/** True when VAPID keys are present. Configures web-push once. */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch {
    console.warn(JSON.stringify({ event: "push_vapid_invalid" }));
    configured = false;
  }
  return configured;
}

/** Test-only: forget cached configuration. */
export function __resetPushConfigForTest(): void {
  configured = null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "New order" alert. No buyer name/phone/address by design. */
export function newOrderPayload(o: {
  billNumber: string;
  totalPaise: number;
  itemCount: number;
  dropId: string | null;
}): PushPayload {
  return {
    title: "🛒 New order",
    body: `${o.billNumber} · ${formatINR(o.totalPaise)} · ${plural(o.itemCount, "item", "items")}`,
    url: o.dropId ? dropOrdersHref(o.dropId) : "/orders",
    tag: `order-${o.billNumber}`,
  };
}

/** Buyer entered a UPI reference — vendor should match it in their UPI app. */
export function paymentSubmittedPayload(o: {
  billNumber: string;
  totalPaise: number;
  dropId: string | null;
}): PushPayload {
  return {
    title: "💸 Customer says paid",
    body: `${o.billNumber} · ${formatINR(o.totalPaise)} — check your UPI app, then tap Payment received`,
    url: o.dropId ? dropOrdersHref(o.dropId) : "/orders",
    tag: `pay-${o.billNumber}`,
  };
}

export type SendResult = { sent: number; removed: number; failed: number };

/** Send to every opted-in device of the vendor's active staff (or only `userId`'s). */
export async function sendToVendor(
  vendorId: string,
  payload: PushPayload,
  opts: { userId?: string } = {},
): Promise<SendResult> {
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  if (!isPushConfigured()) return result;

  const subs = await prisma.pushSubscription.findMany({
    where: {
      vendorId,
      ...(opts.userId ? { userId: opts.userId } : {}),
      user: { staffMemberships: { some: { vendorId, isActive: true } } },
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
  });
  if (subs.length === 0) return result;

  const body = JSON.stringify(payload);
  const outcomes = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: TTL_SECONDS,
        urgency: "high",
        timeout: SEND_TIMEOUT_MS,
      }),
    ),
  );

  const ok: string[] = [];
  const dead: string[] = [];
  const flaky: string[] = [];
  outcomes.forEach((o, i) => {
    const sub = subs[i]!;
    if (o.status === "fulfilled") {
      ok.push(sub.id);
      return;
    }
    const status = (o.reason as { statusCode?: number } | undefined)?.statusCode;
    if (status === 404 || status === 410 || sub.failureCount + 1 >= MAX_FAILURES) dead.push(sub.id);
    else flaky.push(sub.id);
  });

  // vendorId in every write = tenant isolation even for our own bookkeeping.
  await Promise.all([
    ok.length &&
      prisma.pushSubscription.updateMany({
        where: { id: { in: ok }, vendorId },
        data: { lastSuccessAt: new Date(), failureCount: 0 },
      }),
    dead.length && prisma.pushSubscription.deleteMany({ where: { id: { in: dead }, vendorId } }),
    flaky.length &&
      prisma.pushSubscription.updateMany({
        where: { id: { in: flaky }, vendorId },
        data: { failureCount: { increment: 1 } },
      }),
  ]);

  result.sent = ok.length;
  result.removed = dead.length;
  result.failed = flaky.length;
  console.info(JSON.stringify({ event: "push_sent", vendorId, tag: payload.tag.split("-")[0], ...result }));
  return result;
}

/**
 * Fire-and-forget for request handlers: never throws, never delays the
 * response, and keeps the function alive on Vercel until the send settles.
 */
export function notifyVendorInBackground(vendorId: string, payload: PushPayload): void {
  if (!isPushConfigured()) return;
  const p = sendToVendor(vendorId, payload).catch((err: unknown) => {
    console.error(
      JSON.stringify({
        event: "push_failed",
        vendorId,
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  });
  try {
    waitUntil(p);
  } catch {
    // Outside a Vercel request context the promise still runs to completion.
  }
}
