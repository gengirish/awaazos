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
  taxPaise: z.number().int().min(0),
  totalPaise: z.number().int(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  upiRef: z.string().max(120).optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  voiceTranscript: z.string().optional().nullable(),
  source: z.nativeEnum(OrderSource).default(OrderSource.MANUAL),
  notes: z.string().optional().nullable(),
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
  | { ok: false; code: "subtotal_mismatch" | "total_mismatch" };

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
  const recomputed = body.subtotalPaise - body.discountPaise + body.taxPaise;
  if (recomputed !== body.totalPaise) {
    return { ok: false, code: "total_mismatch" };
  }
  return { ok: true };
}
