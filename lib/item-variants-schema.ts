/**
 * Request schema for PUT /api/menu/[id]/variants (rules in lib/item-variants.ts).
 * Its own module so the store page, which imports lib/item-variants.ts, never
 * pulls in zod.
 */

import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { MAX_STOCK_QTY } from "@/lib/inventory";
import { MAX_VARIANTS_PER_ITEM, normaliseVariantLabel, VARIANT_LABEL_MAX } from "@/lib/item-variants";

function isWholePaise(n: number): boolean {
  try {
    rupeesToPaise(n);
    return true;
  } catch {
    return false;
  }
}

const stockCount = z
  .number({ error: "Enter a whole number" })
  .int("Enter a whole number")
  .min(0, "Can't be below 0")
  .max(MAX_STOCK_QTY, `At most ${MAX_STOCK_QTY.toLocaleString("en-IN")}`);

const variantInputSchema = z
  .object({
    /** An existing variant of this item; absent = a new one. */
    id: z.string().min(1).max(64).optional(),
    label: z
      .string()
      .transform(normaliseVariantLabel)
      .pipe(
        z
          .string()
          .min(1, "Name each size or colour")
          .max(VARIANT_LABEL_MAX, `At most ${VARIANT_LABEL_MAX} characters`),
      ),
    /** null / absent = the item's price. */
    priceInRupees: z
      .number()
      .refine((n) => Number.isFinite(n) && n > 0, "Price must be greater than 0")
      .refine(isWholePaise, "At most 2 decimal places")
      .nullable()
      .optional(),
    isAvailable: z.boolean().optional(),
    /** A new count (moves `stockCountedAt`); null stops tracking; absent leaves it. */
    stockQty: stockCount.nullable().optional(),
    lowStockAt: stockCount.nullable().optional(),
  })
  .strict();

/**
 * Body of PUT /api/menu/[id]/variants: the item's whole list, in order. Ids not
 * in it are deleted; old bills keep their name snapshot (rule 2).
 */
export const itemVariantsSchema = z
  .object({ variants: z.array(variantInputSchema).max(MAX_VARIANTS_PER_ITEM, `At most ${MAX_VARIANTS_PER_ITEM}`) })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.variants.forEach((v, i) => {
      const key = v.label.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["variants", i, "label"], message: "Each name only once" });
      seen.add(key);
    });
    const ids = body.variants.flatMap((v) => (v.id ? [v.id] : []));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Repeated id" });
  });

export type ItemVariantsInput = z.infer<typeof itemVariantsSchema>;
