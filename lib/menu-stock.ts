/**
 * The seller's side of stock on /menu (rules in lib/inventory.ts). Pure and
 * client-safe: the request schemas for PATCH / POST /api/menu and
 * POST /api/menu/[id]/stock, and the arithmetic the card's −/+ uses.
 *
 * `stockQty: null` stops tracking (rule 1). Setting a number records a new
 * count (`recordStockCount` moves `stockCountedAt`), so the form only sends it
 * when the seller changed it: re-saving the same "In stock now" would forget
 * the orders taken since the last count.
 */

import type { MenuItem } from "@prisma/client";
import { z } from "zod";

import { MAX_STOCK_QTY } from "@/lib/inventory";

const stockCount = z
  .number({ error: "Enter a whole number" })
  .int("Enter a whole number")
  .min(0, "Can't be below 0")
  .max(MAX_STOCK_QTY, `At most ${MAX_STOCK_QTY.toLocaleString("en-IN")}`);

/** The stock keys PATCH / POST /api/menu accept beside the item fields. */
export const menuStockFieldsSchema = z
  .object({
    /** A new count; null stops tracking. */
    stockQty: stockCount.nullable().optional(),
    /** "Low stock" from this many left; null = no warning. */
    lowStockAt: stockCount.nullable().optional(),
  })
  .strict();

export type MenuStockFields = z.infer<typeof menuStockFieldsSchema>;

const STOCK_KEYS = ["stockQty", "lowStockAt"] as const;

/**
 * Split a request body into its stock keys and the rest, so each half goes
 * through its own schema (the item update schema is strict and refined).
 */
export function splitStockFields(raw: unknown): { stock: Record<string, unknown>; rest: unknown } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { stock: {}, rest: raw };
  const rest: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const stock: Record<string, unknown> = {};
  for (const key of STOCK_KEYS) {
    if (key in rest) {
      stock[key] = rest[key];
      delete rest[key];
    }
  }
  return { stock, rest };
}

export function hasStockFields(fields: MenuStockFields): boolean {
  return fields.stockQty !== undefined || fields.lowStockAt !== undefined;
}

/** Body of POST /api/menu/[id]/stock: record a count, or move it by ±n. */
export const stockChangeSchema = z.union([
  z.object({ set: stockCount }).strict(),
  z
    .object({
      adjust: z
        .number()
        .int("Enter a whole number")
        .min(-MAX_STOCK_QTY)
        .max(MAX_STOCK_QTY)
        .refine((n) => n !== 0, "Change by at least 1"),
    })
    .strict(),
]);

export type StockChange = z.infer<typeof stockChangeSchema>;

/**
 * The count an adjust records: what is left now plus the change, kept within
 * 0..MAX_STOCK_QTY. An oversold item (left < 0) that gets +5 has 3 left.
 */
export function adjustedCount(left: number, delta: number): number {
  return Math.min(MAX_STOCK_QTY, Math.max(0, left + delta));
}

/** A count typed in the form or the "Set count" box: "" → null, else a whole number in range. */
export function parseStockInput(text: string): { value: number | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  if (!/^\d+$/.test(t)) return { error: "Enter a whole number" };
  const n = Number(t);
  if (n > MAX_STOCK_QTY) return { error: `At most ${MAX_STOCK_QTY.toLocaleString("en-IN")}` };
  return { value: n };
}

/** What GET /api/menu and the /menu page add to each row. */
export type WithStockLeft = { stockLeft: number | null };

/** One row on the /menu screen. */
export type MenuRow = MenuItem & WithStockLeft;
