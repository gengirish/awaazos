import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";

/** Split a comma-separated string into a deduplicated, trimmed array. */
function parseCsvToArray(csv: string | undefined): string[] {
  if (csv == null || csv.trim() === "") return [];
  return Array.from(new Set(csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0)));
}

/** Split comma-separated aliases for voice matching. */
export function parseAliasesCsv(csv: string | undefined): string[] {
  return parseCsvToArray(csv);
}

/** Split comma-separated tags for filtering and Claude context. */
export function parseTagsCsv(csv: string | undefined): string[] {
  return parseCsvToArray(csv);
}

/**
 * Menu photos live in Vercel Blob (uploaded via POST /api/menu/[id]/image).
 * Anything else is rejected: next/image only allowlists that host in
 * `next.config.mjs`, so a foreign URL would render as a broken tile, and
 * accepting arbitrary URLs makes the field an injection surface.
 */
export function isMenuImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
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
      .number({ error: "Price is required" })
      .refine((n) => Number.isFinite(n) && n > 0, "Price must be greater than 0"),
  ),
  aliasesCsv: z.string().optional(),
  tagsCsv: z.string().optional(),
  emoji: z.string().max(8).optional(),
  category: z.string().trim().max(80).optional(),
  hsnCode: z
    .string()
    .trim()
    .max(16, "HSN/SAC must be at most 16 characters")
    .optional(),
  isPopular: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  showOnline: z.boolean().optional(),
};

/** Client / RHF input validation (no paise transform). */
export const menuItemCreateInputSchema = z.object(menuItemCreateFields);

export const menuItemCreateSchema = menuItemCreateInputSchema.transform((data) => ({
  name: data.name,
  priceInPaise: rupeesToPaise(data.priceInRupees),
  aliases: parseAliasesCsv(data.aliasesCsv),
  tags: parseTagsCsv(data.tagsCsv),
  emoji: data.emoji ?? "🍽️",
  category: data.category?.trim() ? data.category.trim() : "General",
  hsnCode: data.hsnCode?.trim() ? data.hsnCode.trim().toUpperCase() : null,
  isPopular: data.isPopular ?? false,
  isAvailable: data.isAvailable ?? true,
  showOnline: data.showOnline ?? true,
}));

export const menuItemUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    priceInRupees: z.coerce
      .number()
      .refine((n) => Number.isFinite(n) && n > 0, "Price must be greater than 0")
      .optional(),
    aliasesCsv: z.string().optional(),
    tagsCsv: z.string().optional(),
    emoji: z.string().max(8).optional(),
    category: z.string().trim().max(80).optional(),
    hsnCode: z.string().trim().max(16).optional().nullable(),
    isPopular: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    showOnline: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
    // `null` clears the photo; the upload route sets it, the form can unset it.
    imageUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(isMenuImageUrl, "Image URL must be a Vercel Blob URL")
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.priceInRupees !== undefined ||
      d.aliasesCsv !== undefined ||
      d.tagsCsv !== undefined ||
      d.emoji !== undefined ||
      d.category !== undefined ||
      d.hsnCode !== undefined ||
      d.isPopular !== undefined ||
      d.isAvailable !== undefined ||
      d.showOnline !== undefined ||
      d.sortOrder !== undefined ||
      d.imageUrl !== undefined,
    { message: "At least one field is required", path: ["_root"] },
  );

export type MenuItemCreateParsed = z.infer<typeof menuItemCreateSchema>;
export type MenuItemUpdateBody = z.infer<typeof menuItemUpdateSchema>;

// ─── Voice menu builder: POST /api/menu/bulk ─────────────────────────────────

/** Most rows one voice menu draft / one bulk save may carry. */
export const MENU_BULK_MAX_ITEMS = 50;
/** ₹1,00,000 — above this a spoken price is a mishearing, not a menu price. */
export const MENU_MAX_PRICE_PAISE = 10_000_000;
export const MENU_NAME_MAX = 80;

const bulkItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(MENU_NAME_MAX),
  priceInPaise: z
    .number()
    .int("Price must be whole paise")
    .positive("Price must be greater than 0")
    .max(MENU_MAX_PRICE_PAISE, "Price looks too high"),
  category: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((c) => (c ? c : "General")),
  emoji: z
    .string()
    .max(8)
    .optional()
    .transform((e) => (e?.trim() ? e : "🍽️")),
  aliases: z.array(z.string().trim().min(1).max(MENU_NAME_MAX)).max(30).default([]),
  existingMenuItemId: z.string().trim().min(1).max(64).nullish(),
});

/**
 * Body of POST /api/menu/bulk. Extra keys on a row (key, action, priceSpoken…
 * from a MenuDraftItem) are stripped, so the UI can post draft rows as-is.
 */
export const menuBulkBodySchema = z.object({
  items: z.array(bulkItemSchema).min(1).max(MENU_BULK_MAX_ITEMS),
});

export type MenuBulkItem = z.infer<typeof bulkItemSchema>;
export type MenuBulkBody = z.infer<typeof menuBulkBodySchema>;
