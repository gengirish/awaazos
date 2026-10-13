import { OrderSource, PaymentMethod } from "@prisma/client";
import { z } from "zod";

export const transactionPostItemSchema = z.object({
  menuItemId: z.string().min(1).optional(),
  name: z.string().min(1),
  priceInPaise: z.number().int().positive(),
  qty: z.number().int().positive(),
});

export const transactionPostBodySchema = z.object({
  items: z.array(transactionPostItemSchema).min(1),
  subtotalPaise: z.number().int(),
  discountPaise: z.number().int().min(0).default(0),
  // The offer the POS applied (lib/offers.ts). The server re-prices it.
  offerId: z.string().min(1).max(64).optional().nullable(),
  offerName: z.string().trim().max(60).optional().nullable(),
  taxPaise: z.number().int().min(0),
  totalPaise: z.number().int(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  upiRef: z.string().max(120).optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  voiceTranscript: z.string().optional().nullable(),
  source: z.nativeEnum(OrderSource).default(OrderSource.MANUAL),
  notes: z.string().optional().nullable(),
  // POS offline outbox (docs/PWA_OFFLINE_PLAN.md). `clientRef` dedupes durably;
  // `vendorId` pins the sale to the tenant it was rung up for; `deferred` marks a
  // background sync of a sale taken earlier, whose `clientCreatedAt` then sets
  // the bill date.
  clientRef: z.string().uuid().optional(),
  clientCreatedAt: z.string().datetime({ offset: true }).optional(),
  vendorId: z.string().min(1).optional(),
  deferred: z.boolean().optional(),
});

export type TransactionPostBody = z.infer<typeof transactionPostBodySchema>;

export function expectedSubtotalPaise(items: { priceInPaise: number; qty: number }[]): number {
  let s = 0;
  for (const i of items) {
    s += i.priceInPaise * i.qty;
  }
  return s;
}

export type TotalsCheckResult =
  | { ok: true }
  | { ok: false; code: "subtotal_mismatch" | "total_mismatch" | "discount_mismatch" };

export function checkTransactionTotals(body: {
  items: { priceInPaise: number; qty: number }[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
}): TotalsCheckResult {
  const expected = expectedSubtotalPaise(body.items);
  if (expected !== body.subtotalPaise) {
    return { ok: false, code: "subtotal_mismatch" };
  }
  if (body.discountPaise > body.subtotalPaise) {
    return { ok: false, code: "discount_mismatch" };
  }
  const recomputed = body.subtotalPaise - body.discountPaise + body.taxPaise;
  if (recomputed !== body.totalPaise) {
    return { ok: false, code: "total_mismatch" };
  }
  return { ok: true };
}

/** A deferred sale may be this far ahead of the server clock (device skew). */
export const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Oldest deferred sale the server accepts (plan decision D4). */
export const MAX_DEFERRED_SALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SaleTimeResult =
  | { ok: true; saleAt: Date; fromClient: boolean }
  | { ok: false; code: "client_time_missing" | "client_time_in_future" | "client_time_too_old" };

/**
 * When the sale happened. Live checkouts use the server clock, as before. A
 * deferred (offline-queued) sale uses the device's `clientCreatedAt`, so it
 * lands in the IST day, bill number and DailySummary of the day it was rung up
 * rather than the day it synced. Bounded both ways against bad device clocks.
 */
export function resolveSaleTime(
  body: { deferred?: boolean; clientCreatedAt?: string },
  now: Date = new Date(),
): SaleTimeResult {
  if (!body.deferred) return { ok: true, saleAt: now, fromClient: false };
  if (!body.clientCreatedAt) return { ok: false, code: "client_time_missing" };
  const saleAt = new Date(body.clientCreatedAt);
  if (saleAt.getTime() > now.getTime() + MAX_CLIENT_CLOCK_SKEW_MS) {
    return { ok: false, code: "client_time_in_future" };
  }
  if (saleAt.getTime() < now.getTime() - MAX_DEFERRED_SALE_AGE_MS) {
    return { ok: false, code: "client_time_too_old" };
  }
  // A sale can't be later than the moment we receive it.
  return { ok: true, saleAt: saleAt > now ? now : saleAt, fromClient: true };
}
