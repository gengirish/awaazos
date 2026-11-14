"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";

import { ItemDetailSheet, ItemDetailTrigger } from "@/components/storefront/ItemDetailSheet";
import { enterItemUrl, itemDetailPath, leaveItemUrl, useCloseOnBack } from "@/components/storefront/item-detail-url";
import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import { ItemPriceHero } from "@/components/storefront/ItemPrice";
import { ShareStoreButton } from "@/components/storefront/ShareStoreButton";
import { formatINRCompact } from "@/lib/currency";
import { variantPriceRange, type StoreSize } from "@/lib/item-variants";
import { stockBadgeText, type StorefrontStock } from "@/lib/storefront-stock";

/**
 * One row (kitchen) or tile (goods store) of a menu that takes no orders
 * (`acceptMenuOrders` off): the store page shows what it sells and the open
 * "Scan to pay" QR. A tap on the name or photo opens the item's detail sheet,
 * without an Add bar, since nothing here goes into a cart.
 */
export type ReadOnlyMenuItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  priceInPaise: number;
  unit: string | null;
  isPopular: boolean;
  description: string | null;
};

export function ReadOnlyMenuRow({
  item,
  layout,
  stock,
  sizes,
  slug,
  storeName,
  initialOpen = false,
}: {
  item: ReadOnlyMenuItem;
  slug: string;
  storeName: string;
  /** Opened from its product link (`/s/<slug>/p/<id>`). */
  initialOpen?: boolean;
  layout: "list" | "gallery";
  stock: StorefrontStock | null;
  /** Its sizes / colours (lib/item-variants.ts); absent when it has none. */
  sizes?: StoreSize[];
}) {
  const [open, setOpen] = useState(initialOpen);
  const openDetail = () => {
    setOpen(true);
    enterItemUrl(slug, item.id);
  };
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) leaveItemUrl(slug);
  };
  const close = useCallback(() => setOpen(false), []);
  useCloseOnBack(slug, open, close);
  const dimmed = stock?.soldOut ?? false;
  const range = sizes ? variantPriceRange(item.priceInPaise, sizes) : null;
  const fromPaise = range?.minPaise ?? sizes?.[0]?.priceInPaise ?? item.priceInPaise;
  const sizeLine = sizes && sizes.length > 0 ? sizes.map((v) => v.label).join(" · ") : null;
  const badges = (
    <>
      <StockBadge stock={stock} />
      {item.isPopular ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Popular
        </span>
      ) : null}
    </>
  );
  const price = (
    <span className="font-mono font-bold tabular-nums text-foreground">
      {range ? <span className="font-sans font-medium text-muted-foreground">from </span> : null}
      {formatINRCompact(fromPaise)}
      {item.unit ? <span className="font-sans font-medium text-muted-foreground"> / {item.unit}</span> : null}
    </span>
  );

  const sheet = (
    <ItemDetailSheet
      open={open}
      triggerId={item.id}
      onOpenChange={onOpenChange}
      share={
        <ShareStoreButton
          vendorName={storeName}
          slug={slug}
          path={itemDetailPath(slug, item.id)}
          text={`${item.name} from ${storeName}`}
        />
      }
      name={item.name}
      emoji={item.emoji}
      imageUrl={item.imageUrl}
      description={item.description}
      dimmed={dimmed}
      price={<ItemPriceHero priceInPaise={fromPaise} sale={null} unit={item.unit} from={range !== null} />}
      badges={stockBadgeText(stock) || item.isPopular ? badges : null}
      sizes={sizeLine ? <p className="text-sm text-muted-foreground">Sizes: {sizeLine}</p> : null}
    />
  );

  if (layout === "gallery") {
    return (
      <li className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-background p-2.5 shadow-xs">
        <ItemPhoto src={item.imageUrl} emoji={item.emoji} name={item.name} size="tile" onOpen={openDetail} dimmed={dimmed} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ItemDetailTrigger detailId={item.id} name={item.name} description={item.description} onOpen={openDetail} />
          {sizeLine ? <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{sizeLine}</span> : null}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            {price}
            {badges}
          </span>
        </span>
        {sheet}
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-primary/4 sm:gap-4 sm:px-4">
      <ItemPhoto src={item.imageUrl} emoji={item.emoji} name={item.name} size="row" onOpen={openDetail} dimmed={dimmed} />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ItemDetailTrigger detailId={item.id} name={item.name} description={item.description} onOpen={openDetail}>
          {badges}
        </ItemDetailTrigger>
        {sizeLine ? <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{sizeLine}</span> : null}
      </span>

      <span className="shrink-0 rounded-lg bg-muted/70 px-2.5 py-1 text-sm">{price}</span>
      {sheet}
    </li>
  );
}

function StockBadge({ stock }: { stock: StorefrontStock | null }) {
  const text = stockBadgeText(stock);
  if (!text) return null;
  return (
    <span
      className={
        stock?.soldOut
          ? "rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
          : "rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary"
      }
    >
      {text}
    </span>
  );
}
