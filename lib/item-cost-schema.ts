/**
 * Wire schema for cost price (rules in lib/item-cost.ts). Its own module so
 * screens that only show a margin never pull in zod.
 */

import { z } from "zod";

import { rupeesToPaise } from "@/lib/currency";
import { MAX_COST_PAISE } from "@/lib/item-cost";

function isWholePaise(n: number): boolean {
  try {
    rupeesToPaise(n);
    return true;
  } catch {
    return false;
  }
}

/** A cost in rupees on the wire: 0 or more, whole paise; null clears it. */
export const costInRupeesSchema = z
  .number({ error: "Enter the cost in rupees" })
  .refine((n) => Number.isFinite(n) && n >= 0, "Cost can't be below 0")
  .refine(isWholePaise, "At most 2 decimal places")
  .refine((n) => n * 100 <= MAX_COST_PAISE, "Cost looks too high")
  .nullable();

/**
 * Take `costInRupees` out of a request body, so the rest goes through its own
 * strict schema. `cost`: undefined = not sent, null = clear, else paise.
 * Throws a ZodError for a bad value.
 */
export function takeCostField(raw: unknown): { cost: number | null | undefined; rest: unknown } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !("costInRupees" in raw)) {
    return { cost: undefined, rest: raw };
  }
  const { costInRupees, ...rest } = raw as Record<string, unknown>;
  const parsed = costInRupeesSchema.parse(costInRupees);
  return { cost: parsed === null ? null : rupeesToPaise(parsed), rest };
}
