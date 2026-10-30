/**
 * Request body of the bulk order routes (`POST /api/drops/[id]/orders/bulk`,
 * `POST /api/storefront-orders/bulk`). Kept out of lib/order-bulk.ts so the
 * orders board, which imports that file, does not ship zod.
 */

import { z } from "zod";

import { BULK_ORDER_ACTIONS, BULK_ORDER_MAX } from "@/lib/order-bulk";

export const bulkOrderActionSchema = z.object({
  orderIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(BULK_ORDER_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: "orderIds must be unique" }),
  action: z.enum(BULK_ORDER_ACTIONS),
});

export type BulkOrderActionInput = z.infer<typeof bulkOrderActionSchema>;
