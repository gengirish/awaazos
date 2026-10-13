import type { Prisma, PrismaClient } from "@prisma/client";

import { applyOffers } from "@/lib/offers";
import { loadResolvedOffers } from "@/lib/offers-server";

/**
 * The server's check on a counter sale's discount (`POST /api/transactions`).
 *
 * The POS prices its own cart (it has to work offline), so the server re-runs
 * `applyOffers` on the posted lines with the offers stored for this vendor:
 *
 *   - **Live sale.** The posted discount must be exactly what the server
 *     computes, or 0 (a till that has not reloaded since the offer was created
 *     charged full price; that is not tampering). Anything else is
 *     `discount_mismatch`: the cashier sees it before the sale is recorded.
 *   - **Deferred (offline-queued) sale.** The money already changed hands, so
 *     the bill is kept as it was rung up. It is still re-priced as of the sale
 *     time; when that agrees, the offer and per-line shares are recorded as
 *     usual, and when it does not, the discount is kept without them.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PosDiscountInput = {
  items: { menuItemId?: string; priceInPaise: number; qty: number }[];
  discountPaise: number;
  offerId?: string | null;
  offerName?: string | null;
};

export type PosDiscountResult =
  | {
      ok: true;
      offerId: string | null;
      offerName: string | null;
      /** One entry per posted item, same order. Sums to the bill's discount. */
      lineDiscounts: number[];
      /** A deferred sale whose discount the server could not reproduce. */
      unverified: boolean;
    }
  | { ok: false; code: "discount_mismatch" };

export async function checkPosDiscount(
  db: Db,
  vendorId: string,
  body: PosDiscountInput,
  opts: { deferred: boolean; saleAt: Date },
): Promise<PosDiscountResult> {
  const none = body.items.map(() => 0);
  const offers = await loadResolvedOffers(db, vendorId, { channel: "POS", now: opts.saleAt });
  const priced = applyOffers(
    body.items.map((i, index) => ({
      key: String(index),
      menuItemId: i.menuItemId ?? null,
      priceInPaise: i.priceInPaise,
      qty: i.qty,
    })),
    offers,
  );

  if (body.discountPaise === 0) {
    return { ok: true, offerId: null, offerName: null, lineDiscounts: none, unverified: false };
  }

  const applied = priced.discounts[0];
  if (applied && priced.discountTotalPaise === body.discountPaise) {
    return {
      ok: true,
      offerId: applied.offerId,
      offerName: applied.name,
      lineDiscounts: priced.lines.map((l) => l.discountPaise),
      unverified: false,
    };
  }

  if (!opts.deferred) return { ok: false, code: "discount_mismatch" };

  // Rung up offline under an offer that has since changed. Keep the bill; only
  // link the offer if it is (still) this vendor's.
  const offer = body.offerId
    ? await db.offer.findFirst({ where: { id: body.offerId, vendorId }, select: { id: true, name: true } })
    : null;
  return {
    ok: true,
    offerId: offer?.id ?? null,
    offerName: body.offerName?.trim() || offer?.name || null,
    lineDiscounts: none,
    unverified: true,
  };
}
