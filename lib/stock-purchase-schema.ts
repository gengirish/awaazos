/** Wire schema for POST /api/menu/[id]/purchases (rules in lib/stock-purchase.ts). */

import { z } from "zod";

import { MAX_STOCK_QTY } from "@/lib/inventory";
import { costInRupeesSchema } from "@/lib/item-cost-schema";
import { MAX_PURCHASE_LINES } from "@/lib/stock-purchase";

const receiveLine = z
  .object({
    /** The size or colour received; required when the item has them (rule 5). */
    variantId: z.string().min(1).max(64).optional(),
    qty: z
      .number({ error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(1, "Enter at least 1")
      .max(MAX_STOCK_QTY, `At most ${MAX_STOCK_QTY.toLocaleString("en-IN")}`),
  })
  .strict();

export const receiveStockSchema = z
  .object({
    lines: z.array(receiveLine).min(1, "Enter how many came in").max(MAX_PURCHASE_LINES),
    /** What each piece cost; absent or null = keep the cost on record (rule 4). */
    costInRupees: costInRupeesSchema.optional(),
  })
  .strict()
  .refine((body) => new Set(body.lines.map((l) => l.variantId ?? "")).size === body.lines.length, {
    message: "Each size once",
    path: ["lines"],
  });

export type ReceiveStockBody = z.infer<typeof receiveStockSchema>;
