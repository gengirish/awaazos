import { Tag } from "lucide-react";

import { offerNudgeText, offerSummary, type OfferNudge, type ResolvedOffer } from "@/lib/offers";

/**
 * The offers a buyer can earn in this section ("Weekly Plan: 4+ quiche items
 * incl. 1 paneer → 10% off"). Display only: the order is priced on the server.
 */
export function OfferChips({ offers }: { offers: readonly ResolvedOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <ul aria-label="Offers" className="mb-3 space-y-2">
      {offers.map((o) => (
        <li
          key={o.id}
          className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-sm"
        >
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

/**
 * What the cart is getting, and what one more item would unlock. The region
 * stays mounted so a change is announced; it takes no space when empty.
 */
export function OfferCartNote({
  appliedName,
  nudge,
}: {
  appliedName: string | null;
  nudge: OfferNudge | null;
}) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {appliedName || nudge ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
          <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            {appliedName ? `${appliedName} applied.` : null}
            {appliedName && nudge ? " " : null}
            {nudge ? offerNudgeText(nudge) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}
