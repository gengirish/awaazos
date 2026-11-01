import { formatINRCompact } from "@/lib/currency";
import { formatPercentBps, type SalePrice } from "@/lib/offers";

/**
 * An item's price on the store page. On sale (`salePriceFor` in lib/offers.ts)
 * it reads "~~₹399~~ ₹319 / 250 g · 20% off": the struck-out price, then what
 * one unit costs, which is what the cart charges. Screen readers get one
 * sentence instead, since most of them don't announce strikethrough.
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
        <s className="font-mono font-medium tabular-nums text-muted-foreground">{formatINRCompact(priceInPaise)}</s>
        <span className="font-mono font-bold tabular-nums text-foreground">
          {formatINRCompact(sale.salePricePaise)}
          {unitSuffix}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success"
      >
        {percent} off
      </span>
    </>
  );
}
