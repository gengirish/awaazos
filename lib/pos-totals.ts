import type { CartLine } from "@/lib/cartStore";

export type PosTaxSettings = {
  taxEnabled: boolean;
  /** `VendorSettings.taxPercent` as a decimal string, e.g. "5" or "2.5". */
  taxPercent: string;
};

export type CartTotals = {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** Sum of quantities, not distinct lines. */
  itemCount: number;
};

/**
 * Cart totals in integer paise. One copy for the cart, the sticky checkout bar
 * and the payment sheet, so they can never disagree. The server recomputes and
 * rejects a mismatch (`POST /api/transactions`).
 */
export function computeCartTotals(items: readonly CartLine[], settings: PosTaxSettings): CartTotals {
  let subtotalPaise = 0;
  let itemCount = 0;
  for (const line of items) {
    subtotalPaise += line.priceInPaise * line.qty;
    itemCount += line.qty;
  }
  // Percent → basis points (ARCHITECTURE.md money table), then floor in paise.
  const taxBps = settings.taxEnabled ? Math.round(Number(settings.taxPercent) * 100) : 0;
  const taxPaise = taxBps > 0 ? Math.floor((subtotalPaise * taxBps) / 10_000) : 0;
  return { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise, itemCount };
}
