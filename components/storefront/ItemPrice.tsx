import { ArrowDown } from "lucide-react";

import { formatINRCompact } from "@/lib/currency";
import { formatPercentBps, type SalePrice } from "@/lib/offers";

/**
 * An item's price on the store page's rows and tiles. On sale (`salePriceFor` in
 * lib/offers.ts) it reads discount first, like the detail sheet's `ItemPriceHero`:
 * "↓20% ~~₹399~~ ₹319 / 250 g", ending on what one unit costs, which is what the
 * cart charges. Screen readers get one sentence instead, since most of them
 * don't announce strikethrough.
 */
export function ItemPrice({
  priceInPaise,
  sale,
  unit,
}: {
  priceInPaise: number;
  sale: SalePrice | null;
  unit?: string | null;
}) {
  const unitSuffix = unit ? <span className="font-sans font-medium text-muted-foreground"> / {unit}</span> : null;
  if (!sale) {
    return (
      <span className="font-mono font-bold tabular-nums text-foreground">
        {formatINRCompact(priceInPaise)}
        {unitSuffix}
      </span>
    );
  }
  const percent = formatPercentBps(sale.percentBps);
  return (
    <>
      <span className="sr-only">
        {`${formatINRCompact(sale.salePricePaise)}${unit ? ` per ${unit}` : ""}, ${percent} off, was ${formatINRCompact(priceInPaise)} (${sale.offerName})`}
      </span>
      <span aria-hidden="true" className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <span className="inline-flex items-center gap-0.5 self-center font-bold text-success">
          <ArrowDown className="h-3.5 w-3.5" />
          {percent}
        </span>
        <s className="font-mono font-medium tabular-nums text-muted-foreground">{formatINRCompact(priceInPaise)}</s>
        <span className="font-mono font-bold tabular-nums text-foreground">
          {formatINRCompact(sale.salePricePaise)}
          {unitSuffix}
        </span>
      </span>
    </>
  );
}

/**
 * The price at the top of an item's detail sheet, discount first as buyers
 * know it from Flipkart and Amazon: "↓35% ~~₹8~~ ₹5.20 / plate". Same numbers
 * and the same screen-reader sentence as `ItemPrice`; only the order and size differ.
 */
export function ItemPriceHero({
  priceInPaise,
  sale,
  unit,
  from = false,
}: {
  priceInPaise: number;
  sale: SalePrice | null;
  unit?: string | null;
  /** Sizes are priced differently and none is picked: "from ₹X". */
  from?: boolean;
}) {
  const unitSuffix = unit ? <span className="text-base font-medium text-muted-foreground"> / {unit}</span> : null;
  const fromPrefix = from ? <span className="text-base font-medium text-muted-foreground">from </span> : null;
  if (!sale) {
    return (
      <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {fromPrefix}
        {formatINRCompact(priceInPaise)}
        {unitSuffix}
      </p>
    );
  }
  const percent = formatPercentBps(sale.percentBps);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="sr-only">
        {`${formatINRCompact(sale.salePricePaise)}${unit ? ` per ${unit}` : ""}, ${percent} off, was ${formatINRCompact(priceInPaise)} (${sale.offerName})`}
      </span>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5 text-xl font-bold text-success">
        <ArrowDown className="h-5 w-5" />
        {percent}
      </span>
      <s aria-hidden="true" className="font-mono text-base font-medium tabular-nums text-muted-foreground">
        {formatINRCompact(priceInPaise)}
      </s>
      <span aria-hidden="true" className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {fromPrefix}
        {formatINRCompact(sale.salePricePaise)}
        {unitSuffix}
      </span>
    </p>
  );
}
