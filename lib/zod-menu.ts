import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";

/** Split comma-separated aliases for voice matching. */
export function parseAliasesCsv(csv: string | undefined): string[] {
  if (csv == null || csv.trim() === "") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function preprocessRupeesInput(val: unknown): unknown {
  if (val === "" || val === null || val === undefined) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string") return val.trim() === "" ? undefined : Number(val);
  return val;
}

const menuItemCreateFields = {
  name: z.string().trim().min(1, "Name is required"),
  priceInRupees: z.preprocess(
    preprocessRupeesInput,
    z
      .number({ required_error: "Price is required", invalid_type_error: "Price is required" })
      .refine((n) => Number.isFinite(n) && n > 0, "Price must be greater than 0"),
  ),
  aliasesCsv: z.string().optional(),
  emoji: z.string().max(8).optional(),
  category: z.string().trim().max(80).optional(),
  isPopular: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
};

/** Client / RHF input validation (no paise transform). */
export const menuItemCreateInputSchema = z.object(menuItemCreateFields);

export const menuItemCreateSchema = menuItemCreateInputSchema.transform((data) => ({
  name: data.name,
  priceInPaise: rupeesToPaise(data.priceInRupees),
  aliases: parseAliasesCsv(data.aliasesCsv),
  emoji: data.emoji ?? "🍽️",
  category: data.category?.trim() ? data.category.trim() : "General",
  isPopular: data.isPopular ?? false,
  isAvailable: data.isAvailable ?? true,
}));

export const menuItemUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    priceInRupees: z.coerce
      .number()
      .refine((n) => Number.isFinite(n) && n > 0, "Price must be greater than 0")
      .optional(),
    aliasesCsv: z.string().optional(),
    emoji: z.string().max(8).optional(),
    category: z.string().trim().max(80).optional(),
    isPopular: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.priceInRupees !== undefined ||
      d.aliasesCsv !== undefined ||
      d.emoji !== undefined ||
      d.category !== undefined ||
      d.isPopular !== undefined ||
      d.isAvailable !== undefined ||
      d.sortOrder !== undefined,
    { message: "At least one field is required", path: ["_root"] },
  );

export type MenuItemCreateParsed = z.infer<typeof menuItemCreateSchema>;
export type MenuItemUpdateBody = z.infer<typeof menuItemUpdateSchema>;
