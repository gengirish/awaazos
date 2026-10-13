import type { CartLine } from "@/lib/cartStore";
import { applyOffers, type AppliedDiscount, type OfferNudge, type ResolvedOffer } from "@/lib/offers";

export type PosTaxSettings = {
  taxEnabled: boolean;
  /** `VendorSettings.taxPercent` as a decimal string, e.g. "5" or "2.5". */
  taxPercent: string;
  /** Offers live at the counter when the page was rendered (lib/offers.ts). */
  offers?: readonly ResolvedOffer[];
};

export type CartTotals = {
  subtotalPaise: number;
  /** Offer discount on the eligible lines; 0 when no offer applies. */
  discountPaise: number;
  /** The offer behind `discountPaise`, or null. */
  offer: AppliedDiscount | null;
  /** A better offer the cart is close to, for the cashier to mention. */
  nudge: OfferNudge | null;
  taxPaise: number;
  totalPaise: number;
  /** Sum of quantities, not distinct lines. */
  itemCount: number;
};

/** What "Collect payment" hands to the payment sheet and on to the server. */
export type PayTotals = {
  subtotalPaise: number;
  discountPaise: number;
  offerId: string | null;
  offerName: string | null;
  taxPaise: number;
  totalPaise: number;
};

export function toPayTotals(t: CartTotals): PayTotals {
  return {
    subtotalPaise: t.subtotalPaise,
    discountPaise: t.discountPaise,
    offerId: t.offer?.offerId ?? null,
    offerName: t.offer?.name ?? null,
    taxPaise: t.taxPaise,
    totalPaise: t.totalPaise,
  };
}

/**
 * Cart totals in integer paise. One copy for the cart, the sticky checkout bar
 * and the payment sheet, so they can never disagree. Offers apply here, so a
 * cart built by voice gets them exactly like a tapped one. Tax is charged on
 * the discounted value. The server recomputes the discount and rejects a
 * mismatch (`POST /api/transactions`).
 */
export function computeCartTotals(items: readonly CartLine[], settings: PosTaxSettings): CartTotals {
  let itemCount = 0;
  for (const line of items) itemCount += line.qty;

  const offered = applyOffers(
    items.map((line) => ({
      key: line.menuItemId,
      menuItemId: line.menuItemId,
      priceInPaise: line.priceInPaise,
      qty: line.qty,
    })),
    settings.offers ?? [],
  );
  const { subtotalPaise, discountTotalPaise: discountPaise } = offered;

  // Percent → basis points (ARCHITECTURE.md money table), then floor in paise.
  const taxBps = settings.taxEnabled ? Math.round(Number(settings.taxPercent) * 100) : 0;
  const taxPaise = taxBps > 0 ? Math.floor(((subtotalPaise - discountPaise) * taxBps) / 10_000) : 0;
  return {
    subtotalPaise,
    discountPaise,
    offer: offered.discounts[0] ?? null,
    nudge: offered.nudge,
    taxPaise,
    totalPaise: subtotalPaise - discountPaise + taxPaise,
    itemCount,
  };
}
