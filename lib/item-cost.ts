/**
 * Cost price: what one unit of a product costs the seller. Pure, client-safe
 * and zod-free (the wire schema is lib/item-cost-schema.ts); the database side
 * is lib/item-cost-server.ts. Plan and reasons
 * in docs/COST_AND_PROFIT_PLAN.md.
 *
 * Rules:
 *
 *   1. Optional. `costInPaise === null` means "not recorded", never zero:
 *      anything built on cost leaves that item out. A store that fills none in
 *      sees nothing new.
 *   2. Private. Only MANAGER and OWNER read or write it (`canSeeCost`). Rows
 *      sent to anyone else carry null (`hideCost`), public pages never select
 *      it, and it never enters the voice prompt.
 *   3. One cost per item or size: the latest. A size without its own cost uses
 *      the item's (`unitCostFor`), like its price.
 *   4. A bill line keeps the cost of its moment (`OrderItem.costInPaise`,
 *      written by `stampOrderCosts`), so changing a cost never rewrites what
 *      an old sale earned.
 */

import { formatINR, rupeesToPaise } from "@/lib/currency";

/** ₹1,00,000, the same ceiling as a price (lib/zod-menu.ts). */
export const MAX_COST_PAISE = 10_000_000;

type Role = "CASHIER" | "MANAGER" | "OWNER";

/** Who may read and write cost (rule 2). */
export function canSeeCost(role: Role): boolean {
  return role === "MANAGER" || role === "OWNER";
}

/** The cost of one unit: the size's own, else the item's, else none (rule 3). */
export function unitCostFor(itemCostPaise: number | null, variantCostPaise?: number | null): number | null {
  return variantCostPaise ?? itemCostPaise;
}

/** What one unit earns over its cost, or null when no cost is recorded. May be negative. */
export function marginPaise(pricePaise: number, costPaise: number | null): number | null {
  return costPaise === null ? null : pricePaise - costPaise;
}

type CostRow = { costInPaise: number | null; variants?: { costInPaise: number | null }[] };

/** The row as someone who may not see cost gets it: every cost null (rule 2). */
export function hideCost<T extends CostRow>(row: T): T {
  return {
    ...row,
    costInPaise: null,
    ...(row.variants ? { variants: row.variants.map((v) => ({ ...v, costInPaise: null })) } : {}),
  };
}

/** Rows for this role: as they are for MANAGER and up, costs nulled for anyone else. */
export function rowsForRole<T extends CostRow>(rows: T[], role: Role): T[] {
  return canSeeCost(role) ? rows : rows.map(hideCost);
}

/** A cost as typed in a form: blank = none recorded, else rupees with at most 2 decimals, 0 or more. */
export function parseCostInput(text: string): { paise: number | null } | { error: string } {
  const s = text.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (s === "") return { paise: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { error: /^\d*\.\d{3,}$/.test(s) ? "Use at most 2 decimal places" : "Enter the cost in rupees, like 450 or 99.50" };
  }
  let paise: number;
  try {
    paise = rupeesToPaise(Number(s));
  } catch {
    return { error: "Use at most 2 decimal places" };
  }
  if (paise > MAX_COST_PAISE) return { error: "Cost looks too high. Check it" };
  return { paise };
}

/** "Cost ₹450 · Margin ₹349" for the seller's item card, or null when no cost is recorded. */
export function costLine(pricePaise: number, costPaise: number | null): string | null {
  const margin = marginPaise(pricePaise, costPaise);
  if (costPaise === null || margin === null) return null;
  return margin < 0
    ? `Cost ${formatINR(costPaise)} · Loss ${formatINR(-margin)}`
    : `Cost ${formatINR(costPaise)} · Margin ${formatINR(margin)}`;
}
