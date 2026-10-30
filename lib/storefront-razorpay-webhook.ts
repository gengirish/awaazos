/**
 * What a storefront Razorpay webhook does AFTER its signature checked out. Shared
 * by the per-vendor route (`/api/webhooks/razorpay-orders/[vendorId]`, pasted-keys
 * stores) and the partner route (`/api/webhooks/razorpay-partner`, "Connect
 * Razorpay" stores) so the paid-marking rules can't drift apart.
 *
 * Returns "ack" for anything handled, irrelevant or unmatched (Razorpay must stop
 * retrying) and "retry" only for our own failures. Never logs the body or any
 * customer field.
 */

import { markOrderPaid } from "@/lib/drops";
import { prisma } from "@/lib/prisma";

const PAYMENT_EVENTS = new Set(["payment.captured", "order.paid"]);

type Json = Record<string, unknown>;

export function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
export function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** Parse a verified body; null for non-JSON or non-object. */
export function parseWebhookBody(rawBody: string): Json | null {
  try {
    return obj(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

/**
 * Which orders this delivery may touch: one vendor (path-scoped secret), or the
 * Razorpay account named in the body (platform-wide partner secret).
 */
export type PaymentEventScope = { kind: "vendor"; vendorId: string } | { kind: "account"; accountId: string };

export async function applyRazorpayPaymentEvent(
  body: Json,
  scope: PaymentEventScope,
  via: "webhook" | "partner_webhook",
): Promise<"ack" | "retry"> {
  const event = str(body.event) ?? "";
  if (!PAYMENT_EVENTS.has(event)) return "ack";

  const payload = obj(body.payload);
  const payment = obj(obj(payload?.payment)?.entity);
  const rzOrder = obj(obj(payload?.order)?.entity);

  const razorpayOrderId = str(payment?.order_id) ?? str(rzOrder?.id);
  const razorpayPaymentId = str(payment?.id);
  if (!razorpayOrderId) return "ack";

  // Amount actually paid, in paise.
  const amountPaid = int(payment?.amount) ?? int(rzOrder?.amount_paid);
  const currency = str(payment?.currency) ?? str(rzOrder?.currency) ?? "INR";
  // Our notes live on the order; payment notes only carry Checkout's own.
  const notesTxnId = str(obj(rzOrder?.notes)?.transactionId) ?? str(obj(payment?.notes)?.transactionId);

  const logScope = scope.kind === "vendor" ? { vendorId: scope.vendorId } : {};

  try {
    const txn = await prisma.transaction.findFirst({
      where:
        scope.kind === "vendor"
          ? { razorpayOrderId, vendorId: scope.vendorId, source: "STOREFRONT" }
          : {
              razorpayOrderId,
              source: "STOREFRONT",
              vendor: { settings: { is: { razorpayAccountId: scope.accountId } } },
            },
      select: { id: true, vendorId: true, totalPaise: true, paymentStatus: true },
    });
    if (!txn) {
      console.warn(JSON.stringify({ event: "webhook_rzp_orders_unmatched", via, ...logScope, rzEvent: event }));
      return "ack";
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
          via,
          vendorId: txn.vendorId,
          transactionId: txn.id,
          rzEvent: event,
          notesMatch: !notesTxnId || notesTxnId === txn.id,
          amountMatch: amountPaid === txn.totalPaise,
          currencyMatch: currency === "INR",
        }),
      );
      return "ack";
    }
    if (txn.paymentStatus === "PAID") return "ack";

    const marked = await prisma.$transaction((tx) =>
      markOrderPaid(tx, {
        vendorId: txn.vendorId,
        transactionId: txn.id,
        razorpayOrderId,
        razorpayPaymentId,
      }),
    );
    console.info(
      JSON.stringify({
        event: marked ? "storefront_rzp_paid" : "storefront_rzp_paid_unapplied",
        via,
        rzEvent: event,
        vendorId: txn.vendorId,
        transactionId: txn.id,
      }),
    );
    return "ack";
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "webhook_rzp_orders_failed",
        via,
        ...logScope,
        error: e instanceof Error ? e.name : "unknown",
        code: (e as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return "retry";
  }
}
