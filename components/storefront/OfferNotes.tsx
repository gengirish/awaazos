import { Tag } from "lucide-react";

import {
  offerGiftText,
  offerNudgeText,
  offerSetAsideText,
  offerSummary,
  type OffersResult,
  type ResolvedOffer,
} from "@/lib/offers";

/**
 * The offers a buyer can earn in this section ("Weekly Plan: 4+ quiche items
 * incl. 1 paneer → 10% off"), as one compact box so the items start sooner on a
 * phone. Display only: the order is priced on the server.
 */
export function OfferChips({ offers }: { offers: readonly ResolvedOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <ul
      aria-label="Offers"
      className="mb-4 divide-y divide-primary/15 rounded-xl border border-primary/30 bg-primary/8 px-3 text-sm"
    >
      {offers.map((o) => (
        <li key={o.id} className="flex items-start gap-2 py-1.5">
          <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-semibold text-foreground">{offerSummary(o)}</span>
            {o.description ? <span className="block text-muted-foreground">{o.description}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the cart notes read from `applyOffers`. */
export type CartOffers = Pick<OffersResult, "applied" | "nudge" | "gift" | "setAsideSales">;

/**
 * "Weekly Plan applied. Add 1 more item to unlock 15% off (Family Plan)" — or null when there is nothing to say.
 * A gift reads "Festive gift: free Evil Eye Bracelet added." instead of "applied". When the plan
 * replaced sale prices the cards showed, it also says so (`offerSetAsideText`).
 */
export function offerCartNoteText(offered: CartOffers): string | null {
  const { applied, nudge, gift } = offered;
  // The set-aside line names the winning offer too, so it replaces "… added." / "… applied." rather than repeating it.
  const appliedText =
    offerSetAsideText(offered) ?? (gift ? offerGiftText(gift) : applied ? `${applied.name} applied.` : null);
  const parts = [appliedText, nudge ? offerNudgeText(nudge) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * What the cart is getting, and what one more item would unlock. The region
 * stays mounted so a change is announced; it takes no space when empty.
 *
 * `inCartBar`: the page-level cart bar (CartHub) already shows this line where
 * the buyer is looking, so here it is kept for screen readers only.
 */
export function OfferCartNote({ offered, inCartBar = false }: { offered: CartOffers; inCartBar?: boolean }) {
  const text = offerCartNoteText(offered);
  return (
    <div aria-live="polite" aria-atomic="true" className={inCartBar ? "sr-only" : undefined}>
      {text ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
          <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{text}</span>
        </p>
      ) : null}
    </div>
  );
}
