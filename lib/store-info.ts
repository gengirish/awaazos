import type { FulfilmentMode } from "@prisma/client";

import { formatINRCompact } from "@/lib/currency";

/**
 * The "how this store works" line under the store name on /s/[slug]: how the
 * everyday menu is handed over, how buyers pay, the food-safety licence, and
 * the store's rating once it has enough of them.
 * Pure and client-safe; the page passes only what it already loaded.
 *
 * Handover facts appear only when the everyday menu takes orders: each drop
 * shows its own pickup/delivery terms on its card, so a store-wide line would
 * contradict them. Payment appears whenever something can be ordered.
 */
export type StoreFactKind = "pickup" | "delivery" | "payment" | "fssai" | "rating";
export type StoreFact = { kind: StoreFactKind; text: string };

export function storeInfoFacts(input: {
  menuOrdering: boolean;
  fulfilmentMode: FulfilmentMode;
  deliveryFeePaise: number;
  /** A drop is on the page (open, upcoming or sold out). */
  hasDrops: boolean;
  upi: boolean;
  cod: boolean;
  fssaiNumber: string | null;
  /** `publicRatingText()`; null until the store has enough ratings. */
  ratingText?: string | null;
}): StoreFact[] {
  const facts: StoreFact[] = [];
  if (input.ratingText) facts.push({ kind: "rating", text: input.ratingText });
  if (input.menuOrdering) {
    if (input.fulfilmentMode !== "DELIVERY") facts.push({ kind: "pickup", text: "Pickup" });
    if (input.fulfilmentMode !== "PICKUP") {
      facts.push({
        kind: "delivery",
        text: input.deliveryFeePaise > 0 ? `Delivery · ${formatINRCompact(input.deliveryFeePaise)} fee` : "Free delivery",
      });
    }
  }
  if (input.menuOrdering || input.hasDrops) {
    const pay = input.upi && input.cod ? "Pay by UPI or on delivery" : input.upi ? "Pay by UPI" : input.cod ? "Pay on delivery" : null;
    if (pay) facts.push({ kind: "payment", text: pay });
  }
  const fssai = input.fssaiNumber?.trim();
  if (fssai) facts.push({ kind: "fssai", text: `FSSAI Lic. No. ${fssai}` });
  return facts;
}
