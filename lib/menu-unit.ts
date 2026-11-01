import { z } from "zod";

/**
 * `MenuItem.unit`: the pack or selling size printed after the price
 * ("₹399 / 100 g", "₹1,200 / kg", "₹499 / 60 capsules"). Optional; null = none.
 * Pure and client-safe: the item form, POST/PATCH /api/menu, /api/menu/bulk and
 * the voice menu builder all use these rules.
 */

export const MENU_UNIT_MAX = 20;

export const MENU_UNIT_MESSAGE = `Use up to ${MENU_UNIT_MAX} letters and numbers, e.g. 100 g, 60 capsules, kg.`;

const UNIT_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,/×x-]*$/u;

/** Trim and collapse spaces; "" → null. */
export function normaliseMenuUnit(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  return v === "" ? null : v;
}

export function isValidMenuUnit(unit: string): boolean {
  return unit.length <= MENU_UNIT_MAX && UNIT_PATTERN.test(unit);
}

/** For request bodies: string (blank clears it) or null; the result is normalised. */
export const menuUnitSchema = z
  .union([z.string(), z.null()])
  .transform((v) => normaliseMenuUnit(v))
  .refine((v) => v === null || isValidMenuUnit(v), MENU_UNIT_MESSAGE);
